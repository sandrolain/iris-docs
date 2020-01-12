#!/usr/bin/env node

/*eslint no-console: 0 */

const pjson		= require("./package.json");
const path		= require("path");

// https://github.com/sindresorhus/meow
const meow		= require("meow");

// https://github.com/chalk/chalk
const chalk		= require("chalk");

const IrisDocs	= require("./index.js");

const help		= `
${chalk.blue("Usage")}
  $ iris-docs <source-paths> <options>
  $ iris-docs -c ./iris-docs.json

${chalk.blue("<source-paths>")}
  One or more path patterns of the source files to analyze, separated by commas, from which to extract the documentation

${chalk.blue("Options")}
	--assets, -a    Assets list to copy into output folder
	--out, -o       Docs output directory
	--iris, -i		Path to iris.css file
	--config, -c	Path to json configuration file. If no parameter is passed search iris-docs.json in the current directory

${chalk.blue("Examples")}
  $ iris-docs "./src/*.scss" -o ./out
`;

const cli = meow(help, {
	flags: {
		out: {
			type: "string",
			alias: "o"
		},
		assets: {
			type: "string",
			alias: "a"
		},
		iris: {
			type: "string",
			alias: "i"
		},
		config: {
			type: "string",
			alias: "c"
		}
	}
});

console.log(chalk.blue(`Iris Docs ${pjson.version}`));

const cfgFilePath	= cli.flags.config || path.join(process.cwd(), "iris-docs.json");
var	cfgJson			= {};

try
{
	cfgJson			= require(cfgFilePath);
}
catch(e)
{
	if(cli.flags.config)
	{
		console.log(chalk.red(`The configuration file "${cli.flags.config}" could not be loaded`));
		err			= true;
	}
}

// Extend defualt config with json file config
const options		= Object.assign({
	splitCodeBlocks: true,
	inputFilesPatterns: []
}, cfgJson);

if(cli.input[0])
{
	options.inputFilesPatterns = cli.input[0].split(",").map((path) => path.trim()).filter((path) => path != "");
}

if(cli.flags.assets)
{
	options.assetsToCopy = cli.flags.assets.split(",").map((path) => path.trim()).filter((path) => path != "");
}

if(cli.flags.out)
{
	options.outputDirPath = cli.flags.out;
}

if(cli.flags.iris)
{
	options.irisCssFilePath = cli.flags.iris;
}

var err				= false;

if(options.inputFilesPatterns.length < 1)
{
	console.log(chalk.red("You must specify at least one sources path pattern"));
	err			= true;
}

if(!options.outputDirPath)
{
	console.log(chalk.red("You can not leave the destination path empty"));
	err			= true;
}
else
{
	options.outputDirPath = path.resolve(process.cwd(), options.outputDirPath);
}

if(options.irisCssFilePath)
{
	options.irisCssFilePath = path.resolve(process.cwd(), options.irisCssFilePath);
}


if(err)
{
	console.log(help);
}
else
{
	const docs = new IrisDocs(options);

	docs.run().then((res) =>
	{
		//console.log(docs.filesList.map((file) => file.filePath));

		for(let file of res.filesList)
		{
			console.log(chalk.green(`Generated: <outputDir>/${file.relativePath}`));
		}

		for(let file of res.assetsList)
		{
			console.log(chalk.yellow(`Copied: <outputDir>/${file.relativePath}\n\tFrom: ${file.originPath}`));
		}

	}).catch((e) =>
	{
		console.log(chalk.red(e.stack));
	});
}

// console.log(process.cwd());
