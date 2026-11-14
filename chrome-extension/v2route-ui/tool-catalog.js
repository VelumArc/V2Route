/* Curated public homepages; category research is documented in docs/WEBSITE-CATALOG.md. */
(function(root){
  'use strict';
  const groups=['AI','Development','Video','Social','Domestic','Services'];
  const entries=[
    ['AI','ChatGPT','chatgpt.com'],['AI','Claude','claude.ai'],['AI','Gemini','gemini.google.com'],['AI','Grok','grok.com'],['AI','Perplexity','www.perplexity.ai'],['AI','Poe','poe.com'],['AI','Hugging Face','huggingface.co'],['AI','Cursor','cursor.com'],['AI','DeepSeek','chat.deepseek.com'],
    ['Development','GitHub','github.com'],['Development','GitLab','gitlab.com'],['Development','npm','www.npmjs.com'],['Development','PyPI','pypi.org'],['Development','Stack Overflow','stackoverflow.com'],['Development','Docker Hub','hub.docker.com'],['Development','Cloudflare','www.cloudflare.com'],['Development','Vercel','vercel.com'],['Development','MDN','developer.mozilla.org'],
    ['Video','YouTube','www.youtube.com'],['Video','Netflix','www.netflix.com'],['Video','Twitch','www.twitch.tv'],['Video','Disney+','www.disneyplus.com'],['Video','Spotify','open.spotify.com'],['Video','Prime Video','www.primevideo.com'],['Video','Vimeo','vimeo.com'],['Video','TikTok','www.tiktok.com'],
    ['Social','X','x.com'],['Social','Reddit','www.reddit.com'],['Social','Facebook','www.facebook.com'],['Social','Instagram','www.instagram.com'],['Social','Discord','discord.com'],['Social','Telegram','web.telegram.org'],['Social','WhatsApp','web.whatsapp.com'],['Social','LinkedIn','www.linkedin.com'],
    ['Domestic','Bilibili','www.bilibili.com'],['Domestic','Baidu','www.baidu.com'],['Domestic','QQ','www.qq.com'],['Domestic','Weibo','weibo.com'],['Domestic','Zhihu','www.zhihu.com'],['Domestic','Taobao','www.taobao.com'],['Domestic','JD','www.jd.com'],['Domestic','Douyin','www.douyin.com'],['Domestic','Xiaohongshu','www.xiaohongshu.com'],
    ['Services','Google','www.google.com'],['Services','Bing','www.bing.com'],['Services','Wikipedia','www.wikipedia.org'],['Services','Microsoft','www.microsoft.com'],['Services','Apple','www.apple.com'],['Services','Amazon','www.amazon.com'],['Services','Dropbox','www.dropbox.com'],['Services','Notion','www.notion.so'],['Services','Steam','store.steampowered.com']
  ];
  root.ToolCatalog=Object.freeze({groups:Object.freeze(groups),sites:Object.freeze(entries.map(([group,name,host])=>Object.freeze({group,name,url:'https://'+host+'/favicon.ico'})))});
})(globalThis);
