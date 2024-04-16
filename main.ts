import {Command, HelpCommand,} from "https://deno.land/x/cliffy@v1.0.0-rc.3/command/mod.ts";
import {Confirm, prompt,} from "https://deno.land/x/cliffy@v1.0.0-rc.3/prompt/mod.ts";
import {Table} from "https://deno.land/x/cliffy@v1.0.0-rc.3/table/mod.ts";
import {colors} from "https://deno.land/x/cliffy@v1.0.0-rc.3/ansi/colors.ts";

const lineBreak = "\n";

const version = "1.0.0";

if (import.meta.main) {
    await new Command()
        .version(version)
        .default("help")
        // merge
        .command("merge", "merge .editorconfig")
        .arguments("<configA:string> <configB:string>")
        .option("-o, --output <output>", "output file path.", {required: true,})
        .option("--first2win", "in conflict, first wins.")
        .action(merge)
        // compare
        .command("compare", "compare .editorconfig")
        .arguments("<configA:string> <configB:string>")
        .option("--limit <limit:number>", "table length limit")
        .action(compare)
        // help
        .command("help", new HelpCommand().global())
        .parse(Deno.args);
}

export async function merge(
    option: {
        output: string;
        first2win?: boolean;
    },
    configA: string, configB: string) {

    let a;
    let b;
    try {
        a = await Deno.readTextFile(configA);
        b = await Deno.readTextFile(configB);
    } catch (e) {
        console.log(e);
        return;
    }

    const parsedConfigA = parse(a);
    const parsedConfigB = parse(b);

    const compareResults = compareConfigArray(parsedConfigA, parsedConfigB);

    // always new
    await Deno.writeTextFile(option.output, "", {create: true,})
    await writeFileLine(option.output, `# ${configA}`);
    await writeFileLine(option.output, `# ${configB}`);
    await writeFileLine(option.output, "");

    for (const c of compareResults) {
        await writeFileLine(option.output, "");
        await writeFileLine(option.output, c.extension);

        for (const d of c.same) {
            await writeFileLine(option.output, `${d.key} = ${d.valueA}`);
        }

        if (c.diff.length !== 0) {
            await writeFileLine(option.output, "");
            await writeFileLine(option.output, `# conflict`);
            const first2win = option.first2win;
            for (const d of c.diff) {
                const ab = first2win || await selectPrompt(d);
                await writeFileLine(option.output, `${d.key} = ${ab ? d.valueA : d.valueB}`);
            }
        }

        if (c.onlyA.length !== 0) {
            await writeFileLine(option.output, "");
            await writeFileLine(option.output, `# ${configA}`);
            for (const d of c.onlyA) {
                await writeFileLine(option.output, `${d.key} = ${d.valueA}`);
            }
        }

        if (c.onlyB.length !== 0) {
            await writeFileLine(option.output, "");
            await writeFileLine(option.output, `# ${configB}`);
            for (const d of c.onlyB) {
                await writeFileLine(option.output, `${d.key} = ${d.valueB}`);
            }
        }

    }
}

async function writeFileLine(path: string, data: string) {
    await Deno.writeTextFile(path, `${data}${lineBreak}`, {append: true,});
}

async function selectPrompt(diff: Diff): Promise<boolean> {
    const result = await prompt([
        {
            name: "ab",
            message: `${diff.key}${lineBreak}y : ${diff.valueA}${lineBreak}n : ${diff.valueB}`,
            type: Confirm,
        }]);
    return result.ab ?? true;
}

export async function compare(
    option: {
        limit?: number;
    },
    configA: string, configB: string) {
    let a;
    let b;
    try {
        a = await Deno.readTextFile(configA);
        b = await Deno.readTextFile(configB);
    } catch (e) {
        console.log(e);
        return;
    }

    const parsedConfigA = parse(a);
    const parsedConfigB = parse(b);

    const compareResults = compareConfigArray(parsedConfigA, parsedConfigB);

    console.log(colors.brightRed(`A:${configA}`));
    console.log(colors.brightBlue(`B:${configB}`));

    const limit = option.limit ?? 40;

    new Table()
        .header(["same", "diff", "onlyA", "onlyB",])
        .body([
            [
                compareResults.reduce(function (sum, element) {
                    return sum + element.same.length;
                }, 0),
                compareResults.reduce(function (sum, element) {
                    return sum + element.diff.length;
                }, 0),
                compareResults.reduce(function (sum, element) {
                    return sum + element.onlyA.length;
                }, 0),
                compareResults.reduce(function (sum, element) {
                    return sum + element.onlyB.length;
                }, 0),
            ]
        ])
        .border()
        .render();

    let header = ["key", "status", "A", "B"];

    let body = [];

    for (const compareResult of compareResults) {
        body = [];
        console.log(compareResult.extension);

        if (compareResult.same.length !== 0) {
            for (const d of compareResult.same) {
                const v = [];
                v.push(limitText(d.key, limit));
                v.push(colors.brightGreen("same"));
                v.push(limitText(d.valueA, limit));
                v.push(limitText(d.valueB, limit));
                body.push(v);
            }
        }
        if (compareResult.diff.length !== 0) {
            for (const d of compareResult.diff) {
                const v = [];
                v.push(limitText(d.key, limit));
                v.push(colors.brightYellow("diff"));
                v.push(limitText(d.valueA, limit));
                v.push(limitText(d.valueB, limit));
                body.push(v);
            }
        }
        if (compareResult.onlyA.length !== 0) {
            for (const d of compareResult.onlyA) {
                const v = [];
                v.push(limitText(d.key, limit));
                v.push(colors.brightRed("onlyA"));
                v.push(limitText(d.valueA, limit));
                v.push(limitText(d.valueB, limit));
                body.push(v);
            }
        }
        if (compareResult.onlyB.length !== 0) {
            for (const d of compareResult.onlyB) {
                const v = [];
                v.push(limitText(d.key, limit));
                v.push(colors.brightBlue("onlyB"));
                v.push(limitText(d.valueA, limit));
                v.push(limitText(d.valueB, limit));
                body.push(v);
            }
        }

        header = ["key", "status", "A", "B"];

        new Table()
            .header(header)
            .body(body)
            .border()
            .render();
    }

    function limitText(text: string | undefined, limit: number) {
        if (!text || text.length < limit) {
            return text;
        } else {
            return text.substring(0, limit) + "…";
        }
    }


}

function parse(config: string): ParsedEditorConfig[] {
    const array = config.split(/\r\n|\n/);

    const result: ParsedEditorConfig[] = [];
    let current: ParsedEditorConfig = {extension: "", property: new Map<string, string>()};
    for (const s of array) {
        if (s.startsWith("#")) {
            continue;
        }
        const match = s.match(/\[.+]/)?.input;
        if (match) {
            let parsedEditorConfig = result.find(c => c.extension === match);
            if (!parsedEditorConfig) {
                const item: ParsedEditorConfig = {extension: match, property: new Map<string, string>()};
                result.push(item)
                parsedEditorConfig = item;
            }
            current = parsedEditorConfig;
        }
        if (!current.extension) {
            continue;
        }

        const kv = s.split("=");
        if (kv.length !== 2) {
            continue;
        }
        current.property.set(kv[0].trim(), kv[1].trim());
    }

    return result;
}

function compareConfigArray(configA: ParsedEditorConfig[], configB: ParsedEditorConfig[]): CompareResult[] {
    const result: CompareResult[] = [];

    const extensionsA: string[] = configA.map(c => {
        return c.extension;
    });
    const extensionsB: string[] = configB.map(c => {
        return c.extension;
    });

    const intersect = extensionsA.filter(k => extensionsB.includes(k));
    const onlyA = extensionsA.filter(k => !extensionsB.includes(k));
    const onlyB = extensionsB.filter(k => !extensionsA.includes(k));

    for (const k of intersect) {
        const a = configA.find(c => c.extension === k);
        const b = configB.find(c => c.extension === k);
        if (!a || !b) {
            continue;
        }

        const compareResult = compareConfig(a, b);
        result.push(compareResult);
    }

    for (const k of onlyA) {
        const a = configA.find(c => c.extension === k);
        if (!a) {
            continue;
        }

        const compareResult: CompareResult = {
            extension: k,
            same: [],
            diff: [],
            onlyA: [],
            onlyB: []
        };

        for (const [k, v] of a.property) {
            const diff: Diff = {key: k, valueA: v, valueB: undefined};
            compareResult.onlyA.push(diff);
        }

        result.push(compareResult);
    }
    for (const k of onlyB) {
        const b = configB.find(c => c.extension === k);
        if (!b) {
            continue;
        }

        const compareResult: CompareResult = {
            extension: k,
            same: [],
            diff: [],
            onlyA: [],
            onlyB: []
        };

        for (const [k, v] of b.property) {
            const diff: Diff = {key: k, valueA: undefined, valueB: v};
            compareResult.onlyB.push(diff);
        }

        result.push(compareResult);
    }

    return result;
}


function compareConfig(a: ParsedEditorConfig, b: ParsedEditorConfig): CompareResult {
    const compareResult: CompareResult = {
        extension: a.extension,
        same: [],
        diff: [],
        onlyA: [],
        onlyB: []
    };

    const keysA = Array.from(a.property.keys());
    const keysB = Array.from(b.property.keys());

    const keyIntersect = keysA.filter(k => keysB.includes(k));
    const keyOnlyA = keysA.filter(k => !keysB.includes(k));
    const keyOnlyB = keysB.filter(k => !keysA.includes(k));

    // same or diff
    for (const k of keyIntersect) {
        const vA = a.property.get(k);
        const vB = b.property.get(k);
        const diff: Diff = {key: k, valueA: vA, valueB: vB};

        if (diff.valueA === diff.valueB) {
            compareResult.same.push(diff);
        } else {
            compareResult.diff.push(diff);
        }
    }

    // onlyA
    for (const k of keyOnlyA) {
        const vA = a.property.get(k);
        const diff: Diff = {key: k, valueA: vA, valueB: undefined};
        compareResult.onlyA.push(diff);
    }
    // onlyB
    for (const k of keyOnlyB) {
        const vB = b.property.get(k);
        const diff: Diff = {key: k, valueA: undefined, valueB: vB};
        compareResult.onlyB.push(diff);
    }

    return compareResult;
}

type ParsedEditorConfig = {
    extension: string;
    property: Map<string, string>;
}

type Diff = {
    key: string;
    valueA: string | undefined;
    valueB: string | undefined;
}

type CompareResult = {
    extension: string;
    same: Diff[];
    diff: Diff[];
    onlyA: Diff[];
    onlyB: Diff[];
}
