const pjson		= require("./package.json");
const fs		= require("fs");
const path		= require("path");
const glob		= require("glob");
const slugify	= require("slugify");
const shortid	= require("shortid");


class IrisDocs
{
	constructor(config = {})
	{
		this.config = Object.assign({
			inputFilesPatterns: [],
			outputDir: path.join(process.cwd(), "out"),
			outputExt: "html",

			assetsToCopy: [
				path.join(__dirname, "assets", "iris.min.css"),
				path.join(__dirname, "assets", "iris.min.css.map"),
				path.join(__dirname, "assets", "style.css"),
				path.join(__dirname, "assets", "main.js"),
				path.join(__dirname, "assets", "prism.css"),
				path.join(__dirname, "assets", "prism.js"),
				path.join(__dirname, "assets", "elasticlunr.min.js"),
				path.join(__dirname, "assets", "favicon.png")
			],

			splitCodeBlocks: true,
			defaultCategory: "index",
			convertMarkdown: true,

			// TODO: utilizzare callback formatter custom
			formatTextBlock: null,
			formatCodeBlock: null,
			formatItem: null,
			formatCategoryPage: null,
			formatCategoryBody: null
		}, config);

		if(typeof this.config.defaultCategory == "string")
		{
			this.config.defaultCategory = this.config.defaultCategory
				.split(/\s*\/\s*/).map((category) => category.trim());
		}

		this.filesList		= [];
	}

	checkConfig()
	{
		return new Promise((resolve, reject) =>
		{
			if(!this.patternsConfigIsArray())
			{
				reject(new Error("Config \"inputFilesPatterns\" must be an Array of glob patterns"));
			}

			if(!this.patternsConfigIsFilled())
			{
				reject(new Error("Config \"inputFilesPatterns\" must contain at least one glob pattern"));
			}

			if(!this.outputDirectoryExists())
			{
				reject(new Error(`The destination directory does not exist:\n\t${this.config.outputDirPath}`));
			}

			resolve();
		});
	}

	patternsConfigIsArray()
	{
		return (this.config.inputFilesPatterns instanceof Array);
	}

	patternsConfigIsFilled()
	{
		return (this.config.inputFilesPatterns.length > 0);
	}

	outputDirectoryExists()
	{
		return fs.existsSync(this.config.outputDirPath) && fs.lstatSync(this.config.outputDirPath).isDirectory();
	}

	async run()
	{
		return this.checkConfig()
			.then(() => this.findFiles())
			.then((filesPathsList) => this.readFiles(filesPathsList))
			.then((filesList) =>
			{
				this.filesList = filesList;

				return this.extractCommentsFromFiles(filesList);
			})
			.then((filesList) => this.generateCleanStructure(filesList))
			.then((structure) => this.formatStructure(structure))
			.then((formattedStructure) => this.formatSearchIndex(formattedStructure))
			.then((formattedStructure) =>
			{
				const outputFilesList	= this.generateOutputFiles(formattedStructure);
				const copiedAssetsList	= this.copyAssetsFiles();

				return {
					structure: formattedStructure,
					filesList: outputFilesList,
					assetsList: copiedAssetsList
				};
			});
	}

	findFiles()
	{
		const promises = [];

		for(let pattern of this.config.inputFilesPatterns)
		{
			promises.push(this.findPatternFiles(pattern));
		}

		return Promise.all(promises).then((filesPathsList) =>
		{
			filesPathsList = filesPathsList.reduce((res, item) => res.concat(item), []);

			if(filesPathsList.length < 1)
			{
				throw new Error("No files matching the indicated patterns were found");
			}

			return filesPathsList;
		});
	}

	findPatternFiles(pattern)
	{
		return new Promise((resolve, reject) =>
		{
			glob(pattern, (err, files) =>
			{
				if(err)
				{
					reject(err);
				}
				else
				{
					resolve(files);
				}
			});
		});
	}

	readFiles(filesPathsList)
	{
		const promises = [];

		for(let filePath of filesPathsList)
		{
			let file = new IrisDocsFile(this, filePath);

			promises.push(file.readSource());
		}

		return Promise.all(promises);
	}

	extractCommentsFromFiles(filesList)
	{
		const promises = [];

		for(let file of filesList)
		{
			promises.push(file.findDocsComments());
		}

		return Promise.all(promises).then(() => filesList);
	}

	generateCleanStructure(filesList)
	{
		const resStructure = {
			document: {
				metas: {},
				texts: []
			},
			categories: [],
			tree: []
		};

		const categoriesStructures = {};

		const getCategoryStructure = (categoryPath) =>
		{
			const slug	= slugify(categoryPath);
			const url	= this.getOutputFileUrl(slug);

			var categoryData = categoriesStructures[slug] || (categoriesStructures[slug] = {
				sequence: 999999999,
				url,
				slug,
				path: categoryPath,
				metas: {
					sequence: 999999999,
					title: "",
					category: []
				},
				texts: [],
				items: [],
				ants: [],
				empty: true
			});

			return categoryData;
		};

		for(let file of filesList)
		{
			for(let comment of file.comments)
			{
				let type		= comment.getType();

				if(type == "document")
				{
					let documentStructure		= resStructure.document;

					documentStructure.metas		= Object.assign(documentStructure.metas, comment.getMetasObject());
					documentStructure.texts		= documentStructure.texts.concat(comment.getTextsList());
					documentStructure.index		= comment.getIndex();
					documentStructure.url		= this.getOutputFileUrl("index");
				}
				else if(type == "category")
				{
					let categoryParts			= (comment.getCategory() || this.config.defaultCategory);
					let categoryPath			= categoryParts.join(" / ");
					let categoryStructure		= getCategoryStructure(categoryPath);

					categoryStructure.ants		= categoryParts;
					categoryStructure.metas		= Object.assign(categoryStructure.metas, comment.getMetasObject());
					categoryStructure.texts		= categoryStructure.texts.concat(comment.getTextsList());
					categoryStructure.sequence	= Math.min(categoryStructure.sequence, comment.getSequence());
					categoryStructure.index		= comment.getIndex();
					categoryStructure.empty		= (categoryStructure.texts.length < 1 && categoryStructure.items.length < 1);
				}
				else
				{
					let categoryParts			= (comment.getCategory() || this.config.defaultCategory);
					let categoryPath			= categoryParts.join(" / ");
					let categoryStructure		= getCategoryStructure(categoryPath);


					let categoryList		= categoryStructure.items;

					let metas		= comment.getMetasObject(),
						texts		= comment.getTextsList(),
						sequence	= comment.getSequence(),
						index		= comment.getIndex();

					let cleanComment = {
						metas,
						texts,
						sequence,
						index
					};

					categoryList.push(cleanComment);

					categoryStructure.empty		= (categoryStructure.texts.length < 1 && categoryStructure.items.length < 1);
				}
			}
		}


		for(let category in categoriesStructures)
		{
			let categoryStructure	= categoriesStructures[category];
			let categoryItemsList	= categoryStructure.items;

			categoryItemsList.sort((a, b) =>
			{
				let aSeq = a.sequence;
				let bSeq = b.sequence;
				let aInd = a.index;
				let bInd = b.index;

				if(aSeq != bSeq)
				{
					if(aSeq && bSeq)
					{
						return aSeq - bSeq;
					}

					if(aSeq)
					{
						return -1;
					}

					if(bSeq)
					{
						return 1;
					}
				}

				return aInd - bInd;
			});

			resStructure.categories.push(categoryStructure);
		}

		resStructure.categories.sort((a, b) =>
		{
			let aSeq = a.sequence;
			let bSeq = b.sequence;

			if(aSeq && bSeq)
			{
				if(aSeq == bSeq)
				{
					return -1;
				}

				return aSeq - bSeq;
			}

			if(aSeq)
			{
				return -1;
			}

			if(bSeq)
			{
				return 1;
			}

			return -1;
		});


		const getTreeSubCategory = (list, categoryName) =>
		{
			return list.find((item) => (item.title == categoryName));
		};

		const getCategoryData = (categorySlug) =>
		{
			return categoriesStructures[categorySlug];
		};


		// Build categories tree
		for(let categoryData of resStructure.categories)
		{
			let parentList		= resStructure.tree;
			let subCategoryAnts	= [];

			for(let ant of categoryData.ants)
			{
				let data = getTreeSubCategory(parentList, ant);

				subCategoryAnts.push(ant);

				if(!data)
				{
					let subCategoryPath = subCategoryAnts.join(" / ");
					let subCategorySlug	= slugify(subCategoryPath);
					let subCategoryData	= getCategoryData(subCategorySlug);

					data = {
						slug: subCategorySlug,
						path: subCategoryPath,
						ants: subCategoryAnts.slice(0),
						title: ant,
						childs: [],
						icon: subCategoryData ? subCategoryData.metas.icon : null,
						url: subCategoryData ? subCategoryData.url : null,
						defined: !!subCategoryData,
						empty: subCategoryData ? subCategoryData.empty : true
					};

					parentList.push(data);
				}

				parentList = data.childs;
			}
		}

		// TODO: IrisDocs.freezeStructure(resStructure);
		return resStructure;
	}

	formatStructure(structure)
	{
		for(let categoryData of structure.categories)
		{
			for(let textData of categoryData.texts)
			{
				textData.formatted = this.formatTextItem(textData);
			}

			for(let itemData of categoryData.items)
			{
				for(let textData of itemData.texts)
				{
					textData.formatted = this.formatTextItem(textData);
				}

				itemData.formatted = this.formatItem(itemData, categoryData, structure.document);
			}

			categoryData.formatted	= this.formatCategoryPage(categoryData, structure);
		}

		for(let textData of structure.document.texts)
		{
			textData.formatted = this.formatTextItem(textData);
		}

		structure.document.formatted = this.formatIndexPage(structure);

		return structure;
	}

	//// Search Formatters
	formatSearchIndex(structure)
	{
		const searchIndex = [];

		// Indice
		const documentSources = [];

		for(let textData of structure.document.texts)
		{
			if(textData.type != "code")
			{
				documentSources.push(textData.source);
			}
		}

		searchIndex.push({
			title: structure.document.metas.title || "",
			text: IrisDocs.removeFormatting(documentSources.join(" ")),
			url: structure.document.url
		});


		for(const categoryData of structure.categories)
		{
			const categorySources = [];

			for(let textData of categoryData.texts)
			{
				if(textData.type != "code")
				{
					categorySources.push(textData.source);
				}
			}

			for(let itemData of categoryData.items)
			{
				for(let textData of itemData.texts)
				{
					if(textData.type != "code")
					{
						categorySources.push(textData.source);
					}
				}
			}

			searchIndex.push({
				title: categoryData.metas.title || "",
				category: categoryData.metas.category.join(" / "),
				text: IrisDocs.removeFormatting(categorySources.join(" ")),
				url: categoryData.url
			});
		}

		structure.searchIndex = searchIndex;

		return structure;
	}



	//// HTML Formatters

	formatTextItem(textData)
	{
		if(textData.type == "code")
		{
			return this.formatCodeBlock(textData);
		}

		return this.formatTextBlock(textData);
	}

	formatTextBlock(textData)
	{
		if(this.config.formatTextBlock)
		{
			return this.config.formatTextBlock.call(this, textData);
		}

		const source		= IrisDocs.replaceEscapedChars(textData.source);

		const textSource	= (this.config.convertMarkdown) ? IrisDocs.formatMarkdown(source) : IrisDocs.escapeHTML(source);

		return /*html*/`<div class="ird-text">${textSource}</div>`;
	}

	formatCodeBlock(codeData)
	{
		if(this.config.formatCodeBlock)
		{
			return this.config.formatCodeBlock.call(this, codeData);
		}

		if(codeData.example)
		{
			const uid = shortid.generate();

			return /*html*/`<div class="panel panel-tabs">
				<input type="radio" name="tab-${uid}" id="tab-${uid}-render" checked />
				<label class="panel-tab" for="tab-${uid}-render">Example Render</label>
				<div class="panel-cnt"><div class="ird-example__render cnt-border bg-chess">${codeData.source}</div></div>
				<input type="radio" name="tab-${uid}" id="tab-${uid}-code" />
				<label class="panel-tab" for="tab-${uid}-code">Example Code</label>
				<div class="panel-cnt" id="tabcode-${uid}"><pre><code data-lang="${codeData.lang}" class="language-${codeData.lang}">${IrisDocs.escapeHTML(codeData.source)}</code></pre></div>
			</div>`;
		}

		return /*html*/`<div class="ird-code"><pre><code data-lang="${codeData.lang}" class="language-${codeData.lang}">${IrisDocs.escapeHTML(codeData.source)}</code></pre></div>`;
	}

	formatItem(itemData)
	{
		var paramsHTML = [];

		if(itemData.metas.param)
		{
			paramsHTML = itemData.metas.param.map((param) =>
			{
				var paramDescription		= IrisDocs.replaceEscapedChars(param.description);

				paramDescription = (this.config.convertMarkdown) ? IrisDocs.formatMarkdown(paramDescription) : IrisDocs.escapeHTML(paramDescription);

				return /*html*/`
					<dt><code class="fg-accent">${IrisDocs.escapeHTML(param.name)}</code> <em>${IrisDocs.escapeHTML(param.type)}</em></dt>
					<dd>${paramDescription}</dd>
				`;
			});
		}

		if(itemData.metas["return"])
		{
			const param					= itemData.metas["return"];

			var paramDescription		= IrisDocs.replaceEscapedChars(param.description);

			paramDescription = (this.config.convertMarkdown) ? IrisDocs.formatMarkdown(paramDescription) : IrisDocs.escapeHTML(paramDescription);

			const returnHTML = /*html*/`
			<dt><code class="fg-accent">return</code> <em>${IrisDocs.escapeHTML(param.type)}</em></dt>
			<dd>${paramDescription}</dd>
			`;

			paramsHTML.push(returnHTML);
		}

		const title = (this.config.convertMarkdown) ? IrisDocs.formatMarkdown(itemData.metas.title, true) : IrisDocs.escapeHTML(itemData.metas.title);

		return /*html*/`<div class="ird-comment">
			<div class="ird-comment__head">
				<h3 class="ird-comment__title">${title}</h3>
			</div>
			${paramsHTML.length > 0 ? `<div class="ird-comment__params">${paramsHTML.join("")}</div>` : ""}
			<div class="ird-comment__body">${itemData.texts.map((text) => text.formatted).filter((formattedText) => !!formattedText).join("")}</div>
		</div>`;
	}

	formatCategoryBody(categoryData, structure)
	{
		if(categoryData.items.length < 1 && categoryData.texts.length < 1)
		{
			return null;
		}

		const categoryBodyTexts		= categoryData.texts.map((text) => text.formatted).filter((formattedText) => !!formattedText);
		const categoryItemsTexts	= categoryData.items.map((comment) => comment.formatted).filter((formattedComment) => !!formattedComment);

		const categoryBodyHTML		= categoryBodyTexts.length > 0 ? `<div class="ird-category__body">${categoryBodyTexts.join("")}</div>` : "";
		const categoryItemsHTML		= categoryItemsTexts.length > 0 ? `<div class="ird-category__items">${categoryItemsTexts.join("")}</div>` : "";
		const categoryCrumbsHTML	= this.formatCategoryCrumbs(categoryData, structure);
		const categoryMenuHTML		= this.formatCategoryMenu(categoryData, structure);

		const html = /*html*/`<div class="ird-category">
			<h2>${IrisDocs.escapeHTML(categoryData.metas.title)}</h2>
			${categoryCrumbsHTML}
			${categoryMenuHTML}
			${categoryBodyHTML}
			${categoryItemsHTML}
		</div>`;

		return html;
	}

	formatCategoryPage(categoryData, structure)
	{
		const html = this.formatCategoryBody(categoryData, structure);

		if(!html)
		{
			return null;
		}

		return this.formatPage(html, categoryData, structure);
	}

	formatIndexPage(structure)
	{
		const documentData			= structure.document;

		var indexCategoryHTML = "";

		const indexCategoryData = structure.categories.find((categoryData) =>
		{
			return (categoryData.slug == "index");
		});

		if(indexCategoryData)
		{
			indexCategoryHTML = this.formatCategoryBody(indexCategoryData) || "";
		}

		// const categoriesIndex = this.formatIndexMenu(structure) || "";

		const html = /*html*/`<div class="ird-index">
			<div class="ird-index__body">${documentData.texts.map((text) => text.formatted).filter((formattedText) => !!formattedText).join("")}</div>
			${indexCategoryHTML}
		</div>`;

		return this.formatPage(html, documentData, structure);
	}

	// formatIndexMenu(structure)
	// {
	// 	const actCategoryUrl		= structure.document.url;

	// 	const formatMenuBranch = (categoriesList) =>
	// 	{
	// 		const branchHTML = [];

	// 		for(let branchItem of categoriesList)
	// 		{
	// 			let subMenu	= formatMenuBranch(branchItem.childs);

	// 			if(subMenu)
	// 			{
	// 				subMenu	= /*html*/`<div class="menu">${subMenu}</div>`;
	// 			}

	// 			let title = (branchItem.icon ? `${branchItem.icon} ` : "") + IrisDocs.escapeHTML(branchItem.title);

	// 			if(branchItem.url && !branchItem.empty)
	// 			{
	// 				title = `<a href="${branchItem.url}">${title}</a>`;
	// 			}

	// 			branchHTML.push(/*html*/`<div class="menu-item ${branchItem.url && branchItem.url == actCategoryUrl ? "active " : ""}">
	// 				${title}
	// 				${subMenu}
	// 			</div>`);
	// 		}

	// 		return branchHTML.join("");
	// 	};

	// 	const categoriesList	= structure.tree.filter(data => (data.slug != "index"));

	// 	const menuHTML			= formatMenuBranch(categoriesList);

	// 	if(menuHTML)
	// 	{
	// 		const title		= IrisDocs.escapeHTML(structure.document.metas.title);
	// 		const indexUrl	= structure.document.url;

	// 		return  /*html*/`<div class="menu menu-vertical bg-transparent">
	// 			<div class="menu-item ${indexUrl && indexUrl == actCategoryUrl ? "menu-item active " : ""}">
	// 				<a href="${indexUrl}">${title}</a>
	// 			</div>
	// 			${menuHTML}
	// 		</div>`;
	// 	}

	// 	return "";
	// }

	formatSideMenu(categoryData, structure)
	{
		const actCategoryUrl		= categoryData.url;

		const formatMenuBranch = (categoriesList, depth) =>
		{
			const branchHTML = [];

			for(let branchItem of categoriesList)
			{
				let subMenu	= formatMenuBranch(branchItem.childs, depth + 1);

				if(subMenu)
				{
					subMenu	= /*html*/`<div class="menu-tree" style="--ir-menu-depth: ${depth || 0};">${subMenu}</div>`;
				}

				let title = (branchItem.icon ? `${branchItem.icon} ` : "") + IrisDocs.escapeHTML(branchItem.title);

				if(branchItem.url && !branchItem.empty)
				{
					title = `<a href="${branchItem.url}">${title}</a>`;
				}

				branchHTML.push(/*html*/`<div class="menu-item ${branchItem.url && branchItem.url == actCategoryUrl ? "active " : ""}">
					${title}
				</div>
				${subMenu}`);
			}

			return branchHTML.join("");
		};

		const categoriesList	= structure.tree.filter(data => (data.slug != "index"));

		const menuHTML			= formatMenuBranch(categoriesList, 1);

		if(menuHTML)
		{
			const title		= IrisDocs.escapeHTML(structure.document.metas.title);
			const indexUrl	= structure.document.url;

			return  /*html*/`<div class="menu-tree vertical">
				<div class="menu-item ${indexUrl && indexUrl == actCategoryUrl ? "menu-item active " : ""}">
					<a href="${indexUrl}">${title}</a>
				</div>
				${menuHTML}
			</div>`;
		}

		return "";
	}

	formatCategoryCrumbs(categoryData, structure)
	{
		const actCategorySlug = categoryData.slug;
		var categoryCrumbs;

		if(categoryData.metas.category.length > 1)
		{
			let crumbCategory = [];
			let crumbParts    = [];

			for(let item of categoryData.metas.category)
			{
				crumbCategory.push(item);

				let actCategoryPath = crumbCategory.join(" / ");
				let actCategorySlug = slugify(actCategoryPath);

				let actCategoryData = structure.categories.find((categoryData) =>
				{
					return (categoryData.slug == actCategorySlug);
				});

				let itemTitle = IrisDocs.escapeHTML(item);

				let crumbItem = actCategoryData && actCategoryData.url
				? `<a href="${actCategoryData.url}" class="${actCategoryData.url == categoryData.url ? "active " : ""}">${itemTitle}</a>`
				: `<em>${itemTitle}</em>`;
				crumbParts.push(crumbItem);
			}

			categoryCrumbs = crumbParts.join(" / ");
		}

		return categoryCrumbs ? /*html*/`<p class="ird-category__path crumbs">Path: ${categoryCrumbs}</p>`: "";
	}

	formatCategoryMenu(categoryData, structure)
	{
		const actCategoryUrl	= categoryData.url;

		const findMenuBranch	= (categoriesList) =>
		{
			for(let branchItem of categoriesList)
			{
				if(branchItem.url == actCategoryUrl)
				{
					return formatMenuBranch(branchItem.childs);
				}
			}

			return "";
		};

		const formatMenuBranch	= (categoriesList) =>
		{
			const branchHTML = [];

			for(let branchItem of categoriesList)
			{
				let subMenu	= formatMenuBranch(branchItem.childs);

				if(subMenu)
				{
					subMenu	= /*html*/`<div class="menu">${subMenu}</div>`;
				}

				let title = (branchItem.icon ? `${branchItem.icon} ` : "") + IrisDocs.escapeHTML(branchItem.title);

				if(branchItem.url && !branchItem.empty)
				{
					title = `<a href="${branchItem.url}">${title}</a>`;
				}

				branchHTML.push(/*html*/`<div class="menu-item ${branchItem.url && branchItem.url == actCategoryUrl ? "active " : ""}">
					${title}
					${subMenu}
				</div>`);
			}

			return branchHTML.join("");
		};

		const categoriesList	= structure.tree.filter(data => (data.slug != "index"));

		const menuHTML			= findMenuBranch(categoriesList);

		if(menuHTML)
		{
			return  /*html*/`<div class="menu inverse">
				${menuHTML}
			</div>`;
		}

		return "";
	}

	formatPage(html, categoryData, structure)
	{
		const menu	= this.formatSideMenu(categoryData, structure);

		const title = IrisDocs.escapeHTML(structure.document.metas.title || "");

		const disclaimer = `
			Generated with Iris Docs v ${pjson.version}<br/>
			Styled with Iris CSS<br/>
			Syntax highlight with <a href="https://prismjs.com/" target="_blank">prism.js</a><br/>
			Text Search with <a href="http://elasticlunr.com/" target="_blank">elasticlunr.js</a>
		`;

		const sideMenu = menu ? /*html*/`<div class="mr-1@l mr-1@m mr-0@s mb-1@s">
			<div class="ird-page__menu sticky-top cnt-folio p-0 inverse">
				<div class="p-1">
					<input type="search" placeholder="Search" id="menu-search" />
				</div>
				${menu}
			</div>
		</div>` : "";

		return /*html*/`<!DOCTYPE html>
<html>
	<head>
		<title>${title}</title>
		<meta name="viewport" content="width=device-width, initial-scale=1" />
		<link rel="icon" href="favicon.png" />
		<link rel="stylesheet" href="./style.css" type="text/css" media="all" />
		<link rel="stylesheet" href="./prism.css" type="text/css" media="all" />
		<script type="text/javascript" src="./prism.js"></script>
		<script type="text/javascript" src="./elasticlunr.min.js"></script>
		<script type="text/javascript" src="./main.js"></script>
		<link rel="stylesheet" href="https://use.fontawesome.com/releases/v5.7.2/css/all.css" integrity="sha384-fnmOCqbTlWIlj8LyTjo7mOUStjsKC4pOpQbqyi7RrhN7udi9RwhKkMHpvLbHG9Sr" crossorigin="anonymous" />
	</head>
	<body>
		<div class="ird-page w-80 w-95@m w-100@s mh-auto">
			<div class="ird-page__head">
				<h1 class="ird-page__title">${title}</h1>
			</div>
			<div class="flex flex-col@s">
				${sideMenu}
				<div class="ird-page__body cnt-folio flex-flexible">${html}</div>
			</div>
			<div class="ird-page__foot">
				<p class="ird-page__disclaimer">${disclaimer}</p>
			</div>
		</div>
	</body>
</html>
		`;
	}

	generateOutputFiles(structure)
	{
		const filesList = [];

		if(structure.document.formatted)
		{
			const indexOutputFilePath = this.getIndexOutputFilePath();

			fs.writeFileSync(indexOutputFilePath, structure.document.formatted);

			filesList.push({
				absolutePath: indexOutputFilePath,
				relativePath: path.relative(this.getOutputDirPath(), indexOutputFilePath)
			});
		}


		// const categoriesOutputDirPath = this.getCategoriesOutputDirPath();

		// if(!fs.existsSync(categoriesOutputDirPath))
		// {
		// 	fs.mkdirSync(categoriesOutputDirPath);
		// }

		const categoriesList = structure.categories.filter(data => (data.slug != "index"));

		for(let categoryData of categoriesList)
		{
			if(categoryData.formatted)
			{
				let categoryOutputFilePath = this.getCategoryOutputFilePath(categoryData);

				fs.writeFileSync(categoryOutputFilePath, categoryData.formatted);

				filesList.push({
					absolutePath: categoryOutputFilePath,
					relativePath: path.relative(this.getOutputDirPath(), categoryOutputFilePath)
				});
			}
		}

		if(structure.searchIndex)
		{
			const searchIndexJSON			= JSON.stringify(structure.searchIndex, null, "  ");
			const searchIndexOutputFilePath	= this.getSearchIndexOutputFilePath();

			fs.writeFileSync(searchIndexOutputFilePath, searchIndexJSON);

			filesList.push({
				absolutePath: searchIndexOutputFilePath,
				relativePath: path.relative(this.getOutputDirPath(), searchIndexOutputFilePath)
			});
		}


		return filesList;
	}

	getOutputDirPath()
	{
		return this.config.outputDirPath;
	}

	getOutputFileExtension()
	{
		return this.config.outputExt || "html";
	}

	// getCategoriesOutputDirPath()
	// {
	// 	const outputPath = path.join(this.getOutputDirPath(), "docs");

	// 	return outputPath;
	// }

	getSearchIndexOutputFilePath()
	{
		const outputPath	= path.join(this.getOutputDirPath(), "search-index.json");

		return outputPath;
	}

	getIndexOutputFilePath()
	{
		const outputPath	= path.join(this.getOutputDirPath(), `index.${this.getOutputFileExtension()}`);

		return outputPath;
	}

	getCategoryOutputFilePath(categoryData)
	{
		const outputPath	= path.join(this.getOutputDirPath(), `${categoryData.slug}.${this.getOutputFileExtension()}`);

		return outputPath;
	}

	getCategoryOutputFileUrl(categoryData)
	{
		return `${categoryData.slug}.${this.getOutputFileExtension()}`;
	}

	getOutputFileUrl(slug)
	{
		return `${slug}.${this.getOutputFileExtension()}`;
	}

	copyAssetsFiles()
	{
		const assetsFilesPaths	= this.config.assetsToCopy;
		const copiedFilePaths	= [];

		for(let filePath of assetsFilesPaths)
		{
			if(!fs.existsSync(filePath))
			{
				throw new Error(`Assets file "${filePath}" not found!`);
			}

			const fileName		= path.basename(filePath);

			const copyFilePath	= path.join(this.getOutputDirPath(), fileName);

			fs.copyFileSync(filePath, copyFilePath);

			copiedFilePaths.push({
				absolutePath: copyFilePath,
				relativePath: path.relative(this.getOutputDirPath(), copyFilePath),
				originPath: filePath
			});
		}

		return copiedFilePaths;
	}

	// Static methods

	static freezeStructure(obj)
	{
		Object.freeze(obj);

		const props = Object.getOwnPropertyNames(obj);

		for(let prop of props)
		{

			if(obj.hasOwnProperty(prop)
			&& (typeof obj[prop] === "object" || typeof obj[prop] === "function")
			&& obj[prop] !== null
			&& !Object.isFrozen(obj[prop]))
			{
				this.freezeStructure(obj[prop]);
			}
		}

		return obj;
	}

	static formatMarkdown(markDownCode, stripParagraph = false)
	{
		if(!this._md)
		{
			const MarkdownIt = require("markdown-it");

			this._md = new MarkdownIt({
				html: true,
				xhtmlOut: true,
				breaks: true
			});
		}

		const mark = this._md.render(markDownCode);

		if(stripParagraph)
		{
			return mark.replace(/^<p>(.*)<\/p>$/mi, "$1");
		}

		return mark;
	}

	static removeFormatting(str)
	{
		const removeMd = require("remove-markdown");

		return this.cleanSpaces(
			this.stripTags(
				removeMd(str)
			)
		);
	}

	static stripTags(str)
	{
		return str
			.replace(/<style[^>]*>[.\s]*<\/style>/gmi, "")
			.replace(/<script[^>]*>[.\s]*<\/script>/gmi, "")
			.replace(/<\/?[a-z][^>]*>/gmi, "");
	}

	static cleanSpaces(str)
	{
		return str
			.replace(/[\s]+/g, " ");
	}

	static escapeHTML(str)
	{
		return str
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;")
			.replace(/"/g, "&quot;")
			.replace(/'/g, "&#039;");
	}

	static replaceEscapedChars(str)
	{
		return str
			.replace(/\\n/g, "\n")
			.replace(/\\t/g, "\t");
	}

	static readFile(filePath, useCache = false)
	{
		if(useCache)
		{
			let source = this.getFileCache(filePath);

			if(source)
			{
				return Promise.resolve(source);
			}
		}

		return new Promise((resolve, reject) =>
		{
			fs.readFile(filePath, (err, sourceBuffer) =>
			{
				if(err)
				{
					reject(err);
				}
				else
				{
					let source = sourceBuffer.toString("utf8");

					if(useCache)
					{
						this.setFileCache(filePath, source);
					}

					resolve(source);
				}
			});
		});
	}

	static readFileWithCache(filePath)
	{
		return this.readFile(filePath, true);
	}

	static setFileCache(filePath, source)
	{
		if(!this.fileCache)
		{
			this.fileCache = new Map();
		}

		return this.fileCache.set(filePath, source);
	}

	static getFileCache(filePath)
	{
		if(this.fileCache)
		{
			return this.fileCache.get(filePath);
		}

		return null;
	}
}

class IrisDocsFile
{
	constructor(docs, filePath)
	{
		this.docs		= docs;
		this.filePath	= filePath;
		this.source		= "";
		this.comments	= [];
	}

	readSource()
	{
		return IrisDocs.readFile(this.filePath).then((source) =>
		{
			this.source = source;

			return this;
		});
	}

	findDocsComments()
	{
		const commentsRegExp	= new RegExp("\\/\\*\\-{2,}(.*?)\\-{2,}\\*{1,}\\/", "gsmi");
		const comments			= [];
		const promises			= [];
		var index			= 0;
		var m;

		do
		{
			m = commentsRegExp.exec(this.source);

			if (m)
			{
				let comment = new IrisDocsComment(this, m[1].trim(), index);

				comments.push(comment);

				promises.push(comment.parseComment());

				index++;
			}

		} while (m);

		this.comments = comments;

		return Promise.all(promises);
	}
}

class IrisDocsComment
{
	constructor(file, commentSource, index)
	{
		this.file		= file;
		this.filePath	= file.filePath;
		this.dirPath	= path.dirname(this.filePath);
		this.source 	= this.cleanCommentSource(commentSource);
		this.metas		= new Map();
		this.texts		= [];
		this.index		= index;
	}

	cleanCommentSource(commentSource)
	{
		return commentSource.replace(/(^|\n)\s*\*\s+/g, "$1");
	}

	parseComment()
	{
		return this.mergeIncludes()
			.then(() => this.findCommentMetas())
			.then(() => this.findCommentTexts());
	}

	mergeIncludes()
	{
		const includesRegExp	= /@include\s*:?\s+(.*)/gi;
		const includes			= new Map();
		var m;

		do
		{
			m = includesRegExp.exec(this.source);

			if (m)
			{
				let source	= m[0];
				let relPath	= m[1].trim();

				let fullPath	= path.join(this.dirPath, relPath);

				if(!includes.has(fullPath))
				{
					includes.set(fullPath, []);
				}

				let occurrencesList = includes.get(fullPath);

				occurrencesList.push(source);
			}

		} while (m);

		if(includes.size > 0)
		{
			const promises = [];

			for(let [fullPath, occurrences] of includes.entries())
			{
				promises.push(this.includeFile(fullPath, occurrences));
			}

			return Promise.all(promises);
		}

		return Promise.resolve(0);
	}

	includeFile(filePath, occurrences)
	{
		return IrisDocs.readFileWithCache(filePath).then((fileSource) =>
		{
			for(let includeSource of occurrences)
			{
				this.source = this.source.replace(includeSource, fileSource);
			}

			return occurrences.length;
		});
	}

	findCommentMetas()
	{
		const metasRegExp	= /(?:^|\n)\s*@([^\s:]+):?\s+(.*)/gi;
		var m;

		do
		{
			m = metasRegExp.exec(this.source);

			if (m)
			{
				let source	= m[0];
				let key		= m[1].trim().toLowerCase();
				let value	= m[2].trim();

				value = this.parseMetaValue(key, value);

				let data = {
					source,
					key,
					value
				};

				if(key == "param")
				{
					if(!this.metas.has(key))
					{
						this.metas.set(key, []);
					}

					this.metas.get(key).push(data);
				}
				else
				{
					this.metas.set(key, data);
				}

			}

		} while (m);

		return this.metas;
	}

	parseMetaValue(key, value)
	{
		switch(key)
		{
			case "type":		return value.toLowerCase();
			case "tags":		return value.split(/\s*[,;]\s*/).map((tag) => tag.trim());
			case "category":	return value.split(/\s*\/\s*/).map((category) => category.trim());
			case "sequence":	return parseFloat(value, 10);
			case "param":

				var paramParts = value.split(/\s+/);

				var name = paramParts.shift();
				var type = paramParts.shift();

				return {
					name,
					type,
					description: paramParts.join(" ")
				};

			case "return":

				var returnParts = value.split(/\s+/);

				var returnType = returnParts.shift();

				return {
					type: returnType,
					description: returnParts.join(" ")
				};
		}

		return value;
	}

	findCommentTexts()
	{
		var cleanSource			= this.getSourceWithoutMetas();

		if(this.file.docs.config.splitCodeBlocks)
		{
			this.texts = this.splitText(cleanSource);
		}
		else
		{
			this.texts = [{
				type: "text",
				source: cleanSource
			}];
		}

		return this.texts;
	}

	getSourceWithoutMetas()
	{
		const metasRegExp		= /@([^\s:]+):?\s+(.*)/gi;

		return this.source
			.replace(metasRegExp, "")
			.replace(/\n{3,}/, "\n\n");
	}

	splitText(cleanSource)
	{
		const splitStr				= `§ir${Math.round(Math.random() * 100)}§`;
		const codeSplitRegExp		= new RegExp(splitStr, "g");
		const codeBlocksFindRegExp	= new RegExp("```([^\\s]*)(.*?)```", "smgi");
		const codeBlocksParseRegExp	= new RegExp("```([^\\s]*)(.*?)```", "smi");

		const texts				= cleanSource
			.replace(codeBlocksFindRegExp, `${splitStr}$&${splitStr}`)
			.split(codeSplitRegExp)
			.filter((text) => (text.trim() != ""))
			.map((text) =>
			{
				text = text.trim();

				var m = text.match(codeBlocksParseRegExp);

				if(m)
				{
					var	lang = m[1],
						example = false,
						exm = lang.match(/example:(.*)/i),
						source = m[2].trim();

					if(exm)
					{
						lang = exm[1];
						example = true;
					}

					return {
						type: "code",
						example,
						lang,
						source
					};
				}

				return {
					type: "text",
					source: text
				};
			});

		return texts;
	}

	getMeta(metaKey)
	{
		const meta = this.metas.get(metaKey);

		return meta ? meta.value : null;
	}

	getType()
	{
		return this.getMeta("type");
	}

	getTitle()
	{
		return this.getMeta("title");
	}

	getCategory()
	{
		return this.getMeta("category");
	}

	getSequence()
	{
		return this.getMeta("sequence") || 999999999;
	}

	getIndex()
	{
		return this.index;
	}

	getMetasObject()
	{
		const metasObj = {
			title: "",
			category: [],
			sequence: 999999999,
			index: this.index
		};

		for(let key of this.metas.keys())
		{
			let data = this.metas.get(key);

			if(data instanceof Array)
			{
				metasObj[key] = data.map(item => item.value);
			}
			else
			{
				metasObj[key] = data.value;
			}
		}

		return metasObj;
	}

	getTextsList()
	{
		return this.texts.slice(0);
	}
}


module.exports = IrisDocs;
