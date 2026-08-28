import { initAuthCreds, BufferJSON, proto } from "@whiskeysockets/baileys";
import type { AuthenticationCreds, AuthenticationState, SignalDataTypeMap } from "@whiskeysockets/baileys";
import { supabase } from "./supabase.js";

// Store Baileys custom (voir plan-houville.md, section H) : persiste creds + Signal keys dans
// Supabase plutôt que sur le disque local du worker (non fiable entre redéploiements/redémarrages
// sur Koyeb). Une seule ligne ("default") : ce projet n'a qu'un seul worker WhatsApp.
// Calqué sur useMultiFileAuthState (l'implémentation officielle Baileys, voir
// node_modules/@whiskeysockets/baileys/lib/Utils/use-multi-file-auth-state.js), en remplaçant
// le système de fichiers par une seule ligne Postgres. BufferJSON (fourni par Baileys) gère la
// sérialisation des Buffer en JSON, comme le fait l'implémentation officielle.
const ROW_ID = "default";

type KeysBlob = { [category: string]: { [id: string]: unknown } };

function serialize(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value, BufferJSON.replacer));
}

function deserialize<T>(value: unknown): T {
  return JSON.parse(JSON.stringify(value), BufferJSON.reviver) as T;
}

export async function useSupabaseAuthState(): Promise<{
  state: AuthenticationState;
  saveCreds: () => Promise<void>;
}> {
  const { data, error } = await supabase
    .from("baileys_auth_state")
    .select("creds, keys")
    .eq("id", ROW_ID)
    .maybeSingle();
  if (error) throw new Error(`lecture baileys_auth_state : ${error.message}`);

  const creds: AuthenticationCreds = data?.creds ? deserialize(data.creds) : initAuthCreds();
  const keysBlob: KeysBlob = data?.keys ? deserialize(data.keys) : {};

  async function persist() {
    const { error: errUpsert } = await supabase.from("baileys_auth_state").upsert({
      id: ROW_ID,
      creds: serialize(creds),
      keys: serialize(keysBlob),
      updated_at: new Date().toISOString(),
    });
    if (errUpsert) throw new Error(`écriture baileys_auth_state : ${errUpsert.message}`);
  }

  return {
    state: {
      creds,
      keys: {
        get: async <T extends keyof SignalDataTypeMap>(type: T, ids: string[]) => {
          const result: { [id: string]: SignalDataTypeMap[T] } = {};
          const bucket = keysBlob[type] ?? {};
          for (const id of ids) {
            let value = bucket[id];
            if (value && type === "app-state-sync-key") {
              value = proto.Message.AppStateSyncKeyData.fromObject(value as object);
            }
            if (value !== undefined) result[id] = value as SignalDataTypeMap[T];
          }
          return result;
        },
        set: async (data) => {
          for (const category in data) {
            keysBlob[category] = keysBlob[category] ?? {};
            const entries = data[category as keyof typeof data] as Record<string, unknown> | undefined;
            for (const id in entries) {
              const value = entries[id];
              if (value === null || value === undefined) {
                delete keysBlob[category][id];
              } else {
                keysBlob[category][id] = value;
              }
            }
          }
          await persist();
        },
      },
    },
    saveCreds: persist,
  };
}
