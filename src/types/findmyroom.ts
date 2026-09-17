export interface Building {
    /** Building code as used by findmyroom, e.g. "IC2", "PR_39BV". */
    code: string;
    /** Display name; findmyroom currently reuses the code here. */
    nom: string;
    /** Count of rooms free right now. */
    dispo: number;
    /** Total bookable rooms in the building. */
    total: number;
    /** dispo / total as a whole-number percentage, pre-computed by the source. */
    pourcentage: number;
}

export type RoomStatus = "DISPONIBLE" | "OCCUPEE";

export interface Room {
    salle: string;
    statut: RoomStatus;
    capacite: number | null;
    type_salle: string | null;
    /** Human sentence, e.g. "libre jusqu'à 20:00" / "libre à 19:30". */
    libre_jusqua: string | null;
    libre_jusqua_en: string | null;
    /** Human sentence, e.g. "réservable toute la journée". */
    duree_max: string | null;
    duree_max_en: string | null;
}

export interface RoomsForBuilding {
    date: string;
    heure: string;
    salles: Room[];
}
