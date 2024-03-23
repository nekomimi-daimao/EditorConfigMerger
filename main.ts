import {
    Command,
    HelpCommand,
    ValidationError,
} from "https://deno.land/x/cliffy@v1.0.0-rc.3/command/mod.ts";
import {
    Confirm,
    prompt,
} from "https://deno.land/x/cliffy@v1.0.0-rc.3/prompt/mod.ts";

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
        .option("--superior <superior>", "superior.", {
            action: (value) => {
                if (!value.superior || ["a", "b"].includes(value.superior)) {
                    throw new ValidationError(
                        `a or b. "${value.superior}".`
                    );
                }
            },
        })
        .action(merge)
        // compare
        .command("compare", "compare .editorconfig")
        .action(compare)
        .arguments("<configA:string> <configB:string>")
        .option("-b, --beautify", "beautify output.")
        // help
        .command("help", new HelpCommand().global())
        .parse(Deno.args);
}

export async function merge(
    option: {
        output: string;
        superior?: string;
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

    for (const c of compareResults) {
        await writeFileLine(option.output, "");
        await writeFileLine(option.output, c.extension);

        for (const d of c.same) {
            await writeFileLine(option.output, `${d.key} = ${d.valueA}`);
        }

        if (c.diff.length !== 0) {
            await writeFileLine(option.output, "");
            await writeFileLine(option.output, `# conflict`);
            for (const d of c.diff) {
                const ab = await selectPrompt(d);
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

export function compare() {

}

function parse(config: string): ParsedEditorConfig[] {
    const array = config.split(/\r\n|\n/);

    const result: ParsedEditorConfig[] = [];
    let current: ParsedEditorConfig = {extension: "", property: new Map<string, string>()};
    for (let s of array) {
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
