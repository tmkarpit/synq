// Material Icon Theme SVGs (MIT, github.com/material-extensions/vscode-material-icon-theme).
// Each icon is imported individually so only these ~30 small files reach the bundle;
// Vite inlines most of them as data URIs.
import iconC from 'material-icon-theme/icons/c.svg?url';
import iconConsole from 'material-icon-theme/icons/console.svg?url';
import iconCpp from 'material-icon-theme/icons/cpp.svg?url';
import iconCss from 'material-icon-theme/icons/css.svg?url';
import iconDocument from 'material-icon-theme/icons/document.svg?url';
import iconGit from 'material-icon-theme/icons/git.svg?url';
import iconH from 'material-icon-theme/icons/h.svg?url';
import iconHpp from 'material-icon-theme/icons/hpp.svg?url';
import iconHtml from 'material-icon-theme/icons/html.svg?url';
import iconJava from 'material-icon-theme/icons/java.svg?url';
import iconJs from 'material-icon-theme/icons/javascript.svg?url';
import iconJson from 'material-icon-theme/icons/json.svg?url';
import iconMarkdown from 'material-icon-theme/icons/markdown.svg?url';
import iconNode from 'material-icon-theme/icons/nodejs.svg?url';
import iconPython from 'material-icon-theme/icons/python.svg?url';
import iconReact from 'material-icon-theme/icons/react.svg?url';
import iconReactTs from 'material-icon-theme/icons/react_ts.svg?url';
import iconReadme from 'material-icon-theme/icons/readme.svg?url';
import iconTs from 'material-icon-theme/icons/typescript.svg?url';
import iconVite from 'material-icon-theme/icons/vite.svg?url';
import folder from 'material-icon-theme/icons/folder.svg?url';
import folderOpen from 'material-icon-theme/icons/folder-open.svg?url';
import folderApp from 'material-icon-theme/icons/folder-app.svg?url';
import folderAppOpen from 'material-icon-theme/icons/folder-app-open.svg?url';
import folderComponents from 'material-icon-theme/icons/folder-components.svg?url';
import folderComponentsOpen from 'material-icon-theme/icons/folder-components-open.svg?url';
import folderConfig from 'material-icon-theme/icons/folder-config.svg?url';
import folderConfigOpen from 'material-icon-theme/icons/folder-config-open.svg?url';
import folderCss from 'material-icon-theme/icons/folder-css.svg?url';
import folderCssOpen from 'material-icon-theme/icons/folder-css-open.svg?url';
import folderDocs from 'material-icon-theme/icons/folder-docs.svg?url';
import folderDocsOpen from 'material-icon-theme/icons/folder-docs-open.svg?url';
import folderHook from 'material-icon-theme/icons/folder-hook.svg?url';
import folderHookOpen from 'material-icon-theme/icons/folder-hook-open.svg?url';
import folderImages from 'material-icon-theme/icons/folder-images.svg?url';
import folderImagesOpen from 'material-icon-theme/icons/folder-images-open.svg?url';
import folderLib from 'material-icon-theme/icons/folder-lib.svg?url';
import folderLibOpen from 'material-icon-theme/icons/folder-lib-open.svg?url';
import folderPublic from 'material-icon-theme/icons/folder-public.svg?url';
import folderPublicOpen from 'material-icon-theme/icons/folder-public-open.svg?url';
import folderScripts from 'material-icon-theme/icons/folder-scripts.svg?url';
import folderScriptsOpen from 'material-icon-theme/icons/folder-scripts-open.svg?url';
import folderSrc from 'material-icon-theme/icons/folder-src.svg?url';
import folderSrcOpen from 'material-icon-theme/icons/folder-src-open.svg?url';
import folderTest from 'material-icon-theme/icons/folder-test.svg?url';
import folderTestOpen from 'material-icon-theme/icons/folder-test-open.svg?url';
import folderUtils from 'material-icon-theme/icons/folder-utils.svg?url';
import folderUtilsOpen from 'material-icon-theme/icons/folder-utils-open.svg?url';
import { extensionOf } from '@/config/languages';

const BY_NAME = {
  'package.json': iconNode,
  'package-lock.json': iconNode,
  'readme.md': iconReadme,
  '.gitignore': iconGit,
  'vite.config.js': iconVite,
};

const BY_EXTENSION = {
  js: iconJs,
  mjs: iconJs,
  cjs: iconJs,
  jsx: iconReact,
  ts: iconTs,
  tsx: iconReactTs,
  html: iconHtml,
  htm: iconHtml,
  css: iconCss,
  json: iconJson,
  md: iconMarkdown,
  markdown: iconMarkdown,
  py: iconPython,
  java: iconJava,
  c: iconC,
  h: iconH,
  cpp: iconCpp,
  cc: iconCpp,
  hpp: iconHpp,
  sh: iconConsole,
  txt: iconDocument,
};

const FOLDERS = {
  src: [folderSrc, folderSrcOpen],
  app: [folderApp, folderAppOpen],
  public: [folderPublic, folderPublicOpen],
  components: [folderComponents, folderComponentsOpen],
  config: [folderConfig, folderConfigOpen],
  styles: [folderCss, folderCssOpen],
  css: [folderCss, folderCssOpen],
  docs: [folderDocs, folderDocsOpen],
  hooks: [folderHook, folderHookOpen],
  images: [folderImages, folderImagesOpen],
  assets: [folderImages, folderImagesOpen],
  lib: [folderLib, folderLibOpen],
  scripts: [folderScripts, folderScriptsOpen],
  test: [folderTest, folderTestOpen],
  tests: [folderTest, folderTestOpen],
  __tests__: [folderTest, folderTestOpen],
  utils: [folderUtils, folderUtilsOpen],
};

export function fileIconUrl(name = '') {
  return BY_NAME[name.toLowerCase()] || BY_EXTENSION[extensionOf(name)] || iconDocument;
}

export function folderIconUrl(name = '', open = false) {
  const pair = FOLDERS[name.toLowerCase()] || [folder, folderOpen];
  return open ? pair[1] : pair[0];
}
