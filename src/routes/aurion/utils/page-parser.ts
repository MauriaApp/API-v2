// PageParser.ts

export class PageParser {
    static parseViewState(body: string): string {
        const match = body.match(
            /<input type="hidden" name="javax.faces.ViewState" id="j_id1:javax.faces.ViewState:0" value="([^"]+)" autocomplete="off" \/>/
        );
        if (!match) throw new Error("ViewState non trouvé");
        return match[1]!;
    }

    static parseFormId(body: string): string {
        const from = "{PrimeFaces.ab({s:";
        const to = ",f:";
        const snippet = body.substring(
            body.indexOf(">chargerSousMenu = function()"),
            body.indexOf(">chargerSousMenu = function()") + 300
        );
        const idxFrom = snippet.indexOf(from);
        const idxTo = snippet.indexOf(to);
        if (idxFrom === -1 || idxTo === -1)
            throw new Error("FormId non trouvé");
        return snippet
            .substring(idxFrom + from.length, idxTo)
            .replace(/"/g, "");
    }

    static parseIdInit(body: string): string {
        const from = 'name="form:idInit" value="';
        const startIndex = body.indexOf(from);
        if (startIndex === -1) throw new Error("idInit non trouvé");
        const idxTo = body.indexOf('"', startIndex + from.length);
        return body.substring(startIndex + from.length, idxTo);
    }

    static parseMenuId(body: string, keyword = "Mes notes</span>"): string {
        const searchStart = body.indexOf(keyword) - 300;
        const searchEnd = body.indexOf(keyword);
        if (searchStart < 0 || searchEnd < 0)
            throw new Error("MenuId zone non trouvée");
        const snippet = body.substring(searchStart, searchEnd);
        const from = "form:sidebar_menuid':'";
        const to = "'})";
        const idxFrom = snippet.indexOf(from);
        const idxTo = snippet.indexOf(to);
        if (idxFrom === -1 || idxTo === -1)
            throw new Error("MenuId non trouvé");
        return snippet.substring(idxFrom + from.length, idxTo);
    }

    static parseFormIdGrade(body: string): string {
        const to = "Date Ascending";
        const snippet = body.substring(
            body.indexOf(to) - 400,
            body.indexOf(to)
        );
        const from = `<div class="EmptyBox10"></div><div id="form:`;
        const toDelim = `" class="ui-datatable ui-widget`;
        const idxFrom = snippet.indexOf(from);
        const idxTo = snippet.indexOf(toDelim);
        if (idxFrom === -1 || idxTo === -1)
            throw new Error("FormIdGrade non trouvé");
        return snippet.substring(idxFrom + from.length, idxTo);
    }

    static parseFormIdPlanning(body: string): string {
        const to = `class="schedule"><div`;
        const snippet = body.substring(
            body.indexOf(to) - 300,
            body.indexOf(to) + 100
        );
        const from = "</script> <br /> <br /><div id=";
        const toDelim = ` class="schedule">`;
        const idxFrom = snippet.indexOf(from);
        const idxTo = snippet.indexOf(toDelim);
        if (idxFrom === -1 || idxTo === -1)
            throw new Error("FormIdPlanning non trouvé");

        return snippet
            .substring(idxFrom + from.length, idxTo)
            .replace(/"/g, "");
    }

    static parseGrades(body: string): any[] {
        const gradeRows = body.match(/<tr[^>]*>([\s\S]*?)<\/tr>/g);
        if (!gradeRows) {
            throw new Error("Aucune grade trouvée");
        }
        return gradeRows.map((row) => {
            const cells = row.match(/<td[^>]*>([\s\S]*?)<\/td>/g) || [];
            return {
                date: PageParser.extractSpan(cells[0]),
                code: PageParser.extractSpan(cells[1]),
                name: PageParser.extractSpan(cells[2]),
                grade: PageParser.extractSpan(cells[3]),
                coefficient: PageParser.extractSpan(cells[4]),
                average: PageParser.extractSpan(cells[5]),
                min: PageParser.extractSpan(cells[6]),
                max: PageParser.extractSpan(cells[7]),
                median: PageParser.extractSpan(cells[8]),
                standardDeviation: PageParser.extractSpan(cells[9]),
                comment: PageParser.extractSpan(cells[10]),
            };
        });
    }

    private static extractSpan(cell?: string): string {
        if (!cell) return "";
        const match = cell.match(/<span class="preformatted ">([^<]+)<\/span>/);
        return match ? match[1]! : "";
    }

    static parsePlanningData(body: string): any {
        // À implémenter selon structure Planning renvoyée (JSON ou HTML) comme dans ton postPlan
        return body; // placeholder simple
    }

    static parseAbsences(body: string): any[] {
        const absRows = body.match(/<tr data-ri="[^>]*>([\s\S]*?)<\/tr>/g);
        if (!absRows) {
            throw new Error("Aucune absence trouvée");
        }
        return absRows.map((row) => {
            const date = (row.match(
                /<td role="gridcell" style="text-align: left">([^<]+)<\/td>/
            ) || [, ""])[1];
            const cells = [
                ...row.matchAll(/<td role="gridcell">([^<]*)<\/td>/g),
            ].map((m) => m[1]);
            return {
                date,
                type: cells[0] || "",
                duration: cells[1] || "",
                time: cells[2] || "",
                class: cells[3] || "",
                teacher: cells[4] || "",
            };
        });
    }
}
