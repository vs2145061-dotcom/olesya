// Metro: разрешить require() HTML-файла (локальный резерв в App.js: require('./assets/www/index.html'))
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
if (!config.resolver.assetExts.includes('html')) {
  config.resolver.assetExts.push('html');
}

module.exports = config;
