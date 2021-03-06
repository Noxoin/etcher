/*
 * Copyright 2016 Resin.io
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

'use strict';

const _ = require('lodash');
const Bluebird = require('bluebird');
const fs = Bluebird.promisifyAll(require('fs'));
const visuals = require('resin-cli-visuals');
const form = require('resin-cli-form');
const drivelist = Bluebird.promisifyAll(require('drivelist'));
const writer = require('./writer');
const utils = require('./utils');
const options = require('./cli');
const log = require('./log');
const EXIT_CODES = require('../src/exit-codes');

form.run([
  {
    message: 'Select drive',
    type: 'drive',
    name: 'drive'
  },
  {
    message: 'This will erase the selected drive. Are you sure?',
    type: 'confirm',
    name: 'yes',
    default: false
  }
], {
  override: {
    drive: options.drive,

    // If `options.yes` is `false`, pass `undefined`,
    // otherwise the question will not be asked because
    // `false` is a defined value.
    yes: options.robot || options.yes || undefined

  }
}).then((answers) => {
  if (!answers.yes) {
    throw new Error('Aborted');
  }

  const progressBars = {
    write: new visuals.Progress('Flashing'),
    check: new visuals.Progress('Validating')
  };

  return Bluebird.props({
    drives: drivelist.listAsync(),
    bmap: _.attempt(() => {
      if (!options.bmap) {
        return;
      }

      return fs.readFileAsync(options.bmap, {
        encoding: 'utf8'
      });
    })
  }).then((results) => {
    const selectedDrive = _.find(results.drives, {
      device: answers.drive
    });

    if (!selectedDrive) {
      throw new Error(`Drive not found: ${answers.drive}`);
    }

    return writer.writeImage(options._[0], selectedDrive, {
      unmountOnSuccess: options.unmount,
      validateWriteOnSuccess: options.check,
      bmapContents: results.bmap
    }, (state) => {

      if (options.robot) {
        log.toStdout(JSON.stringify({
          command: 'progress',
          data: {
            type: state.type,
            percentage: Math.floor(state.percentage),
            eta: state.eta,
            speed: Math.floor(state.speed)
          }
        }));
      } else {
        progressBars[state.type].update(state);
      }

    });
  });
}).then((results) => {

  return Bluebird.try(() => {
    if (options.robot) {
      return log.toStdout(JSON.stringify({
        command: 'done',
        data: {
          passedValidation: results.passedValidation,
          sourceChecksum: results.sourceChecksum
        }
      }));
    }

    if (results.passedValidation) {
      console.log('Your flash is complete!');
      console.log(`Checksum: ${results.sourceChecksum}`);
    } else {
      console.error('Validation failed!');
    }
  }).then(() => {
    if (results.passedValidation) {
      process.exit(EXIT_CODES.SUCCESS);
    } else {
      process.exit(EXIT_CODES.VALIDATION_ERROR);
    }
  });

}).catch((error) => {

  return Bluebird.try(() => {
    if (options.robot) {
      return log.toStderr(JSON.stringify({
        command: 'error',
        data: {
          message: error.message,
          description: error.description,
          code: error.code
        }
      }));
    }

    utils.printError(error);
  }).then(() => {
    process.exit(EXIT_CODES.GENERAL_ERROR);
  });

}).finally(log.close);
