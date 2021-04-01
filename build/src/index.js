"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const fundo = require("./fundos");
(async () => {
    try {
        await fundo.run();
    }
    catch (ex) {
        console.error(ex);
    }
})();
//# sourceMappingURL=index.js.map