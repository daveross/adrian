// @ts-check

const VERSION = '1.0'
let port = 3000

const yaml = require('js-yaml')
const fs = require('fs')
const dir = require('node-dir')
const fontkit = require('fontkit')
const crypto = require('crypto')
const express = require('express')
const middleware = require('./middleware')
const apicache = require('apicache')
const has = require('./has')
const logger = require('./logger')
const chokidar = require('chokidar')
const path = require('path')
const fontWeights = {
	"thin": 100,
	"extralight": 200,
	"ultralight": 200,
	"light": 300,
	"book": 400,
	"normal": 400,
	"regular": 400,
	"roman": 400,
	"medium": 500,
	"semibold": 600,
	"demibold": 600,
	"bold": 700,
	"extrabold": 800,
	"ultrabold": 800,
	"black": 900,
	"heavy": 900
}

logger.log(`Starting Adrian ${VERSION}`)

/**
 * Read & parse a YAML configuration file
 * @param {string} filename
 * @return {Object} configuration 
 */
const readConfig = (filename) => yaml.safeLoad(fs.readFileSync(filename, 'utf8'))

/**
 * 
 * @param {array[object]} fonts 
 * @param {string} id
 * @return object
 */
const findFontByID = (fonts, id) => Object.values(fonts).filter((x) => x.uniqueID === id).pop()
const findFontByName = (fonts, name) => Object.values(fonts).filter((x) => x.fullName === name).pop()
const findFontsByFamilyName = (fonts, name) => Object.values(fonts).filter((x) => x.fullName.toLowerCase().startsWith(name.toLowerCase()))

/**
 * 
 * @param {Object} font
 * @return string 
 */
function fontType(font) {
    switch(font.constructor.name) {
        case 'TTFFont': return 'ttf'
        case 'WOFF2Font': return 'woff2'
        case 'WOFFFont': return 'woff'
        default: return ''
    }
}

/**
 * Determine or guess a font's CSS weight
 * @param {Object} font 
 */
function guessFontCSSWeight(fontWeights, font) {
    
    let fontVariant = font.subfamilyName.toLowerCase() 
    if('regular' !== fontVariant) {
        if(fontWeights.hasOwnProperty(fontVariant)) {
            return fontWeights[fontVariant]
        }
    }

    for(let fontWeightIndex in fontWeights) {
        if(font.fullName.toLowerCase().replace(/( italic)$/, '').endsWith(' ' + fontWeightIndex)) {
            return fontWeights[fontWeightIndex]
        }
    }

    return fontWeights.regular

}

const config = readConfig('adrian.yaml')

const cacheLifetime = parseInt((has(config, 'global') ? config.global['cache lifetime'] : null) || '5') + ' minutes'

const fontDirectories = (has(config, 'global') && has(config.global, 'directories')) ? config.global.directories : []
const fonts = {}

// Initialize watcher.
const watcher = chokidar.watch(fontDirectories.map((x) => path.resolve(x)), {
    // ignores .dotfiles
    ignored: /(^|[\/\\])\../,
    persistent: true,
    awaitWriteFinish: true
})

/**
 * Add a font to the index
 * @param {string} path 
 * @param {boolean} log 
 * @returns {boolean} if a font was detected at path and added to the index
 */
const addFont = (path, log = true) => { 
    if(path.match(/\/([^.])[^\/]*\.(otf|ttf|woff|woff2)$/i)) {
        const font = fontkit.openSync(path)

        fonts[path] = {
            filename: path,
            type: fontType(font),
            fullName: font.fullName,
            familyName: font.familyName,
            subfamilyName: font.subfamilyName,
            copyright: font.copyright,
            uniqueID: fontUniqueID(config, font) 
        }

        apicache.clear(null)

        if(log) { logger.log(`Added font ${path}`) }

        return true
    }

    return false
}

/**
 * Remove a font from the index
 * @param {string} path 
 * @param {boolean} log
 * @returns {boolean} if a font was detected at path and removed from the index
 */
const deleteFont = (path, log = true) => {
    if(fonts[path]) {
        apicache.clear(null)
        delete fonts[path]
        if(log) { logger.log(`Removed font ${path}`) }
        return true
    }

    return false
}

watcher.on('add', addFont)
watcher.on('unlink', deleteFont)
watcher.on('change', (path) => {
    deleteFont(path. false)
    addFont(path, false) && logger.log(`Updated font ${path}`)
})

/**
 * Assign a unique ID to the font, either a code or the font's name
 * @param {Object} config 
 * @param {Object} font 
 * @return {String}
 */
const fontUniqueID = (config, font) => {
    const configFontKey = Object.keys(config).filter((k) => k !== 'global').reduce(((a,k) => font.fullName.toLowerCase().startsWith(k.toLowerCase()) ? k : a), null)
    const obfuscate = (configFontKey && has(config[configFontKey], 'obfuscate filenames')) ? (config[configFontKey]['obfuscate filenames'] === true) : true
    return obfuscate ? crypto.createHash('sha256').update(font.familyName + ' ' + font.subfamilyName).digest('hex') : font.fullName
}

const fontFaceCSS = (font, protocol) => {
    const fontWeight = guessFontCSSWeight(fontWeights, font)
    return `@font-face {
  font-family: '${font.familyName}';
  font-style: normal;
  font-weight: ${fontWeight};
  src: local('${font.fullName}'), url(${font.uniqueID}.${font.type}) format('${font.type}');
}`.split("\n").map((x) => x.replace(/^\s+/, '')).join(' ')
}

const app = express()

middleware(app, config)

/**
 * Route to serve fonts
 */
app.get('/font/:id\.(otf|ttf|woff|woff2)', (req, res) => {
    fs.createReadStream(findFontByID(fonts, req.params.id).filename).pipe(res)
})

/**
 * Route to serve CSS
 */
app.get('/font/:name\.css', apicache.middleware(cacheLifetime), (req, res)=> {
    if(findFontByName(fonts, req.params.name)) {
        res.send(fontFaceCSS(findFontByName(fonts, req.params.name), req.protocol))
    }
    else {
        res.sendStatus(404)
    }
})

app.get('/font/family/:name.css', apicache.middleware(cacheLifetime), (req, res) => {
    const familyMembers = findFontsByFamilyName(fonts, req.params.name)
    if(familyMembers.length) {
        familyMembers.forEach((font) => res.write(fontFaceCSS(font)) + "\n")
        res.end()
    }
    else {
        res.sendStatus(404)
    }
})

logger.log(`Listening on port ${port}`)
app.listen(port)
