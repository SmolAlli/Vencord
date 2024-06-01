/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Logger } from "@utils/Logger";
import * as Webpack from "@webpack";
import { addPatch, patches } from "plugins";

import { loadLazyChunks } from "./loadLazyChunks";

const ReporterLogger = new Logger("Reporter");

async function runReporter() {
    try {
        ReporterLogger.log("Starting test...");

        let loadLazyChunksResolve: (value: void | PromiseLike<void>) => void;
        const loadLazyChunksDone = new Promise<void>(r => loadLazyChunksResolve = r);

        // The main patch for starting the reporter chunk loading
        addPatch({
            find: '"Could not find app-mount"',
            replacement: {
                match: /(?<="use strict";)/,
                replace: "Vencord.Webpack._initReporter();"
            }
        }, "Vencord Reporter");

        // @ts-ignore
        Vencord.Webpack._initReporter = function () {
            // initReporter is called in the patched entry point of Discord
            // setImmediate to only start searching for lazy chunks after Discord initialized the app
            setTimeout(async () => {
                loadLazyChunks().then(loadLazyChunksResolve);
            }, 0);
        };

        await loadLazyChunksDone;

        for (const patch of patches) {
            if (!patch.all) {
                new Logger("WebpackInterceptor").warn(`Patch by ${patch.plugin} found no module (Module id is -): ${patch.find}`);
            }
        }

        for (const [searchType, args] of Webpack.lazyWebpackSearchHistory) {
            let method = searchType;

            if (searchType === "findComponent") method = "find";
            if (searchType === "findExportedComponent") method = "findByProps";
            if (searchType === "waitFor" || searchType === "waitForComponent") {
                if (typeof args[0] === "string") method = "findByProps";
                else method = "find";
            }
            if (searchType === "waitForStore") method = "findStore";

            try {
                let result: any;

                if (method === "proxyLazyWebpack" || method === "LazyComponentWebpack") {
                    const [factory] = args;
                    result = factory();
                } else if (method === "extractAndLoadChunks") {
                    const [code, matcher] = args;

                    result = await Webpack.extractAndLoadChunks(code, matcher);
                    if (result === false) result = null;
                } else {
                    // @ts-ignore
                    result = Webpack[method](...args);
                }

                if (result == null || (result.$$vencordInternal != null && result.$$vencordInternal() == null)) throw "a rock at ben shapiro";
            } catch (e) {
                let logMessage = searchType;
                if (method === "find" || method === "proxyLazyWebpack" || method === "LazyComponentWebpack") logMessage += `(${String(args[0]).slice(0, 147)}...)`;
                else if (method === "extractAndLoadChunks") logMessage += `([${args[0].map(arg => `"${arg}"`).join(", ")}], ${String(args[1])})`;
                else logMessage += `(${args.map(arg => `"${arg}"`).join(", ")})`;

                ReporterLogger.log("Webpack Find Fail:", logMessage);
            }
        }

        ReporterLogger.log("Finished test");
    } catch (e) {
        ReporterLogger.log("A fatal error occurred:", e);
    }
}

// Run after the Vencord object has been created
setTimeout(runReporter, 0);
