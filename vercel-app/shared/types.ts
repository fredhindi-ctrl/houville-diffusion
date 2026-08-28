export interface Actualite {
  id: number;
  site_id: number;
  titre: string;
  url: string;
  extrait: string | null;
  date_ajout: string;
}

export interface CompteRendu {
  id: number;
  site_id: number;
  titre: string;
  url: string;
  url_pdf: string;
  date_conseil: string;
  date_ajout: string;
}

export interface CompteRenduTexte {
  id: number;
  compte_rendu_id: number;
  texte_extrait: string;
}

export interface MessageAEnvoyer {
  id: number;
  contenu: string;
  statut: "en_attente" | "envoye";
  date_creation: string;
  date_envoi: string | null;
}

// Résultat brut du scraping, avant écriture en base
export interface ActualiteScrapee {
  site_id: number;
  titre: string;
  url: string;
  extrait: string | null;
}

export interface CompteRenduScrape {
  site_id: number;
  titre: string;
  url: string;
  url_pdf: string;
  date_conseil: string; // format ISO (YYYY-MM-DD)
}
