export interface MenuSection {
    title: string;
    items: string[];
}

export interface RestaurantMenu {
    id: string;
    name: string;
    /** 1-based page of the source PDF this menu came from. */
    page: number;
    sections: MenuSection[];
}

export interface DailyMenu {
    /** Human date as printed on the menu, e.g. "mardi 8 septembre 2026" ("" if not found). */
    date: string;
    /** Direct link to the source PDF (all restaurants, all pages). */
    pdfUrl: string;
    restaurants: RestaurantMenu[];
}
