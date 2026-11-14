# HTML data parser

The public IP report is parsed with parse5 7.3.0 and entities 6.0.1, both MIT licensed. These libraries build a plain JavaScript syntax tree. Third-party event attributes never become DOM attributes, and no resource URLs are requested by parsing.

The committed browser bundle is readable and not minified. It is used only for report extraction, never to insert external HTML. MIT notices ship beside the bundle. Versions and npm integrity values are pinned in package-lock.json.

Rebuild with Node.js 20 or later:

```sh
cd vendor-html
npm ci --ignore-scripts
npm run build
```

Upstream: https://github.com/inikulin/parse5 and https://github.com/fb55/entities. esbuild is a build-only dependency. The extension never downloads libraries or executes remote code.
