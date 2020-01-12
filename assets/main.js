(() =>
{
	const el = (selector, parent) =>
	{
		return (parent || document).querySelector(selector);
	};

	const els = (selector) =>
	{
		return document.querySelectorAll(selector);
	};

	window.addEventListener("load", async () =>
	{
		const res = await fetch("search-index.json");
		const searchIndexData = await res.json();

		const searchIndex = elasticlunr(function ()
		{
			this.addField("category");
			this.addField("title");
			this.addField("text");
			this.setRef("url");
		});

		for(const row of searchIndexData)
		{
			searchIndex.addDoc(row);
		}
	
		el("#menu-search").addEventListener("input", (e) =>
		{
			const query = el("#menu-search").value;

			if(query.length)
			{
				for(const $el of els(".menu-tree .menu-item"))
				{
					$el.classList.add("hide");
				}

				const searchResult = searchIndex.search(query, {});

				for(const row of searchResult)
				{
					for(const $el of els(".menu-item"))
					{
						const $a = el("a", $el);

						if($a && $a.getAttribute("href") == row.doc.url)
						{
							$el.classList.remove("hide");
						}
					}
				}
			}
			else
			{
				for(const $el of els(".menu-tree  .menu-item"))
				{
					$el.classList.remove("hide");
				}
			}
		});
	});



})();