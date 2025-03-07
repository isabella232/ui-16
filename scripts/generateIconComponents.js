/* eslint-disable no-console */

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const inq = require('inquirer');
const Figma = require('figma-api');
const chalk = require('chalk');
const ora = require('ora');
const eachLimit = require('async/eachLimit');
const fetch = require('node-fetch');
const { promisify } = require('util');
const SVGO = require('svgo');
const svg2jsx = require('@balajmarius/svg2jsx');
const prettier = require("prettier");

const writeFileAsync = promisify(fs.writeFile);

const iconCachePath = path.join(__dirname, '../config/cachedIconData.json');
const pathToIconComponents = path.join(__dirname, '../src/components/Icon');
const pathToIconExamples = path.join(
  __dirname,
  '../src/documentation/examples/Icon'
);

const figmaIconFileId = 'D9T6BuWxbTVKhlDU8faZSQ9G';
const figmaIconFileUrl = `https://www.figma.com/file/${figmaIconFileId}/`;

const iconsToIgnore = [
  'Grids', // ignore this since it's just the grid background for the icons file
];

const figma = new Figma.Api({
  personalAccessToken: process.env.FIGMA_ACCESS_TOKEN,
});

function saveIconCache(lastModified, icons) {
  const data = {
    lastModified,
    icons,
  };
  fs.writeFileSync(iconCachePath, JSON.stringify(data, null, 2));
}

function getIconCache() {
  try {
    const cacheFile = fs.readFileSync(iconCachePath).toString();
    return JSON.parse(cacheFile);
  } catch (error) {
    return null;
  }
}

/**
 * Get a Figma file object from their API
 *
 * @param {String} fileId  The ID if the Figma file
 */
async function getFigmaFile(fileId) {
  return new Promise(async (resolve, reject) => {
    const [error, figmaFile] = await figma.getFile(fileId);
    if (error) {
      reject(error);
    } else {
      resolve(figmaFile);
    }
  });
}

/**
 * Returns a list of frames for the user to choose from.
 * (Only looks at the first page.)
 *
 * @param {Object} figmaFile
 */
function getFramesToChoose(figmaFile) {
  const frames = figmaFile.document.children[0].children;
  const framesFormatted = frames.map(f => ({
    name: `${f.name} (${f.children.length} children)`,
    value: f.id,
    short: f.name,
  }));
  return framesFormatted;
}

/**
 * Extracts a list of icons in the frame, keyed by their IDs.
 *
 * @param {Object} figmaFile
 * @param {String} frameId
 */
function getIconsFromFrame(figmaFile, frameId) {
  const frame = figmaFile.document.children[0].children.find(
    f => f.id === frameId
  );
  if (frame) {
    return (
      frame.children
        // Filter out any ignored icons
        .filter(icon => !iconsToIgnore.includes(icon.name))
        // Simplify the data structure, just grab what we need
        .map(icon => ({
          id: icon.id,
          name: icon.name,
        }))
        // Create an object keyed by ID
        .reduce((acc, icon) => {
          acc[icon.id] = icon;
          return acc;
        }, {})
    );
  }
  return {};
}

function addUrlsToIcons(icons, renderedIcons) {
  Object.entries(renderedIcons.images).forEach(([id, svgUrl]) => {
    icons[id].svgUrl = svgUrl;
  });
  return icons;
}

/**
 * Returns the icons with the `svgBody` appended.
 *
 * @param {Object} icons
 */
function downloadSvgs(icons) {
  return new Promise((resolve, reject) => {
    const newIcons = Object.assign({}, icons);
    eachLimit(
      icons,
      8, // max parallel downloads
      async icon => {
        if (icon.svgUrl) {
          const res = await fetch(icon.svgUrl);
          const svgBody = await res.text();
          newIcons[icon.id].svgBody = svgBody;
        }
      },
      err => {
        if (err) {
          reject(err);
        }
        resolve(newIcons);
      }
    );
  });
}

const getReactSource = ({ componentName, svg }) => `
/** WARNING
 * This file is automatically generated by the \`yarn gen:icons\` command.
 * ALL changes will be overwritten.
 */
import React from 'react';
import createIconComponent from '../utils/createIconComponent';

const ${componentName}Icon = createIconComponent({
  content: (
    <g>
      ${svg}
    </g>
  ),
});
${componentName}Icon.displayName = '${componentName}Icon';

export default ${componentName}Icon;
`;

const getExampleSource = componentName => `
import React from 'react';
import ${componentName}Icon from '@bufferapp/ui/Icon/Icons/${componentName}';

/** ${componentName} */
export default function ${componentName}IconExample() {
  return (
    <${componentName}Icon size="large" />
  );
}
`;

/**
 * Takes the name of an object in Figma (i.e., 'ico-arrow-down')
 * and converts it to a CamelCase component name ('ArrowDown').
 *
 * @param {String} figmaObjectName
 */
const getComponentName = figmaObjectName => {
  const formatted = figmaObjectName
    .replace(/ico(n)?-/, '')
    .replace(/( \w)/g, m => m[1].toUpperCase())
    .replace(/ /g, '')
    .replace(/(-\w)/g, m => m[1].toUpperCase());
  // Capitalize first char
  return formatted.charAt(0).toUpperCase() + formatted.slice(1);
};

/**
 * This method takes a string which somewhere contains <svg>...</svg>
 * and extracts the contents. It's not super smart, but it works well enough.
 *
 * @param {String} source
 * @returns {String} svg
 */
const getSVGContent = source =>
  source
    // grab everything after the first tag ends (assumed to be <svg ...>)
    .slice(source.indexOf('>') + 1)
    // now split the text on the closing </svg> tag, and take only the first part
    .split('</svg>')[0]
    // trim for good measure
    .trim();

/**
 * Generate and save React component files based on a set of icon data
 * Also generates examples for the documentation.
 *
 * @param {Object} icons
 */
function generateReactIconComponents(icons, spinner) {
  return new Promise(resolve => {
    const iconsCreated = [];
    eachLimit(
      Object.values(icons),
      10,
      async icon => {
        const componentName = getComponentName(icon.name);
        const svg = getSVGContent(icon.svgBodyOptimized);
        const reactSource = getReactSource({ componentName, svg });
        const prettyReactSource = prettier.format(reactSource, { parser: 'babel', singleQuote: true });
        const exampleSource = getExampleSource(componentName);

        const componentFilePath = path.join(
          pathToIconComponents,
          'Icons',
          `${componentName}.jsx`
        );
        const exampleFilePath = path.join(
          pathToIconExamples,
          `${componentName}.jsx`
        );


        await writeFileAsync(componentFilePath, prettyReactSource);
        await writeFileAsync(exampleFilePath, exampleSource);

        spinner.info(chalk.gray(`Created ${componentFilePath}`));

        iconsCreated.push(componentName);
      },
      err => {
        if (err) {
          console.error('Error writing component file!', err);
        }
        resolve(iconsCreated);
      }
    );
  });
}

/**
 * For some reason the Figma API sometimes returns our icons wrapped in a <g clip-path='...'>
 * which causes them to render blank. This method strips out that clip path manually.
 *
 * @todo Revisit this in the future in case we figure it out in the Figma source file or API
 * side, since it feels very hacky/brittle to use a RegEx here for this.
 *
 * @param {String} svgBody
 */
function removeClipPath(svgBody) {
  const clipPathStartRegex = /<g clip-path="url\(#clip0\)">/ims;
  const clipPathEndRegex = /<\/g>\n<defs>\n<clipPath id="clip0">\n(.*?)\n<\/clipPath>\n<\/defs>/ims;

  return svgBody.replace(clipPathStartRegex, '').replace(clipPathEndRegex, '');
}

/**
 * Optimize icon SVG with `svgo`
 *
 * @param {Object} icons
 */
function optimizeSvgs(icons) {
  // https://github.com/svg/svgo/blob/master/examples/test.js
  const svgo = new SVGO({
    // Remove fills so all shapes inherit the CSS color
    plugins: [{ removeAttrs: { attrs: '(stroke|fill)' } }],
  });
  const newIcons = Object.assign({}, icons);
  return new Promise(resolve => {
    eachLimit(
      Object.values(icons),
      10,
      async icon => {
        const removedClipPath = removeClipPath(icon.svgBody);
        let result;
        try {
          result = await svgo.optimize(removedClipPath);
        } catch (e) {
          console.error(
            `Failed to optimize icon ${icon.name} – it's possible the Figma API
          has changed their SVG output. Please ask for help in #proj-design-system.`,
            e
          );
          console.log('Raw icon data:', icon);
          process.exit();
        }
        const transformed = await svg2jsx(result.data);
        newIcons[icon.id].svgBodyOptimized = transformed;
      },
      err => {
        if (err) {
          console.error('Error optimizing SVG! ', err);
        }
        resolve(newIcons);
      }
    );
  });
}

function generateReactIconIndex(icons) {
  const sortedIcons = [...icons].sort();
  const indexContent = sortedIcons
    .map(name => `export ${name} from './Icons/${name}';`)
    .join('\n');
  const pathToIndex = path.join(pathToIconComponents, 'index.js');
  fs.writeFileSync(pathToIndex, `${indexContent}\n`);
}

async function main() {
  let spinner;
  try {
    spinner = ora(`Loading BDS Icons Figma file: ${figmaIconFileUrl}`).start();
    const figmaFile = await getFigmaFile(figmaIconFileId);
    spinner.succeed();

    const cachedIconData = getIconCache();

    // console.log(
    //   chalk.gray('figmaFile.lastModified =>'),
    //   figmaFile.lastModified,
    // );
    // console.log(
    //   chalk.gray('cachedIconData.lastModified =>'),
    //   cachedIconData && cachedIconData.lastModified,
    // );

    let iconsWithSvgData;

    /**
     * If we don't have a cache OR the Figma has changed then we'll update from the API
     */
    if (
      !cachedIconData ||
      cachedIconData.lastModified !== figmaFile.lastModified
    ) {
      console.log(
        chalk.gray('\nNo cache found or Figma file has been updated\n')
      );
      const pagesToChoose = getFramesToChoose(figmaFile);
      const answer = await inq.prompt([
        {
          type: 'list',
          name: 'frameId',
          message: 'Which frame contains the icons?',
          choices: [
            ...pagesToChoose,
            new inq.Separator(),
            { name: 'Cancel', value: 'cancel' },
          ],
        },
      ]);

      if (answer.frameId === 'cancel') {
        process.exit();
      }

      const icons = getIconsFromFrame(figmaFile, answer.frameId);
      const iconIds = Object.keys(icons).join(',');

      spinner.start('Rendering icons to SVG');
      const [err, renderedIcons] = await figma.getImage(figmaIconFileId, {
        ids: iconIds,
        format: 'svg',
      });
      if (err) {
        throw err;
      }
      spinner.succeed();

      // Add the `svgUrl`s to the icons
      const iconsWithUrls = addUrlsToIcons(icons, renderedIcons);

      // Download the icons
      spinner.start('Download SVG files');
      iconsWithSvgData = await downloadSvgs(iconsWithUrls);
      spinner.succeed();

      // Save a cached copy of the output
      saveIconCache(figmaFile.lastModified, iconsWithSvgData);
    } else {
      iconsWithSvgData = cachedIconData.icons;
    }

    spinner.start('Optimize SVGs with svgo');
    const optimizedIcons = await optimizeSvgs(iconsWithSvgData);
    spinner.succeed();

    // Write component files
    spinner.start();
    const iconsGenerated = await generateReactIconComponents(
      optimizedIcons,
      spinner
    );
    spinner.succeed('Generate React components and examples');

    // Write index.js file
    spinner.start('Generate `Icons/index.js`');
    generateReactIconIndex(iconsGenerated);
    spinner.succeed();

    console.log(chalk.bold.green('✔ Done!'));
  } catch (error) {
    if (spinner) {
      spinner.fail();
    }
    console.error(chalk.red('Uh oh! Something went wrong.\n\n'), error);
  }
}

main();
