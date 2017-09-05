/*
 * (C) Copyright 2016 o2r project
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 */


const config = require('../config/config');
const debug = require('debug')('substituter');
const path = require('path');
const exec = require('child_process').exec;
const errorMessageHelper = require('../lib/error-message');

var Stream = require('stream');
const Docker = require('dockerode');
const clone = require('clone');

// check fs & create dirs if necessary
const fse = require('fs-extra');
// fse.mkdirsSync(config.fs.base);
// fse.mkdirsSync(config.fs.incoming);
// fse.mkdirsSync(config.fs.compendium);
const yaml = require('js-yaml');
const writeyaml = require('write-yaml');

var Compendium = require('../lib/model/compendium');

/**
 * function to get metadata of base compenduim
 * @param {object} passon - new compendium id and data of origin compendia
 */
 function getMetadata (passon) {
    return new Promise((fulfill, reject) => {
        debug('[%s] Requesting metadata of base compendium with id - %s ...', passon.id, passon.metadata.substitution.base);
        try {
            Compendium.findOne({ id: passon.metadata.substitution.base}, function (err, res) {
                if (err) {
                    debug('[%s] Error requesting metadata of base compendium.', passon.id);
                    err.status = 400;
                    err.msg = 'base ID is invalid';
                    reject(err);
                } else {
                    if (!res || res == null) {
                      debug('[%s] Error requesting metadata of base compendium.', passon.id);
                      let err = new Error();
                      err.status = 400;
                      err.msg = 'base ID is invalid';
                      reject(err);
                    } else {
                      debug('[%s] Requesting metadata of base compendium with id - %s - successfull.', passon.id, passon.metadata.substitution.base);
                      passon.baseMetaData = res.metadata;
                      fulfill(passon);
                    }
                }
            });
        } catch(err) {
            debug('[%s] Error requesting metadata of base Compendium.', passon.id);
            err.status = 400;
            err.msg = 'base ID is invalid';
            reject(err);
        }
    })
 }

 /**
  * function to check if overlay compenduim exists
  * @param {object} passon - new compendium id and data of origin compendia
  */
  function checkOverlayId (passon) {
     return new Promise((fulfill, reject) => {
         debug('[%s] Checking metadata of overlay compendium with id - %s ...', passon.id, passon.metadata.substitution.overlay);
         try {
             Compendium.findOne({ id: passon.metadata.substitution.overlay}, function (err, res) {
                 if (err) {
                     debug('[%s] Error checking id of overlay Compendium.', passon.id);
                     err.status = 400;
                     err.msg = 'overlay ID is invalid';
                     reject(err);
                 } else {
                     if (!res || res == null) {
                       debug('[%s] Error checking id of overlay Compendium.', passon.id);
                       let err = new Error();
                       err.status = 400;
                       err.msg = 'overlay ID is invalid';
                       reject(err);
                     } else {
                       debug('[%s] Checking metadata of overlay compendium with id - %s - successfull.', passon.id, passon.metadata.substitution.overlay);
                       fulfill(passon);
                     }
                 }
             });
         } catch(err) {
             debug('[%s] Error checking id of overlay Compendium.', passon.id);
             err.status = 400;
             err.msg = 'overlay ID is invalid';
             reject(err);
         }
     })
  }

/**
 * function to create folder for new compendium
 * @param {object} passon - new compendium id and data of origin compendia
 */
function createFolder(passon) {
    return new Promise((fulfill, reject) => {
        var outputPath = path.join(config.fs.compendium, passon.id) + '/data';
        debug('[%s] Creating folder for new compendium ...', passon.id);
        try {
            fse.mkdirsSync(outputPath);
        } catch(err) {
            debug('[%s] Error creating directory for new compendium - err:\n%s', passon.id, err);
            reject('Error creating directory for new compendium id: \n' + err);
        }
        debug('[%s] Created folder for new compendium in: \n # %s\n', passon.id, outputPath);
        passon.substitutedPath = outputPath;
        var basePath = path.join(config.fs.compendium, passon.metadata.substitution.base) + '/data';
        var overlayPath = path.join(config.fs.compendium, passon.metadata.substitution.overlay) + '/data';
        passon.basePath = basePath;
        passon.overlayPath = overlayPath;
        fulfill(passon);
    });
}

/**
 * function to copy base files for new compendium
 * @param {object} passon - new compendium id and data of origin compendia
 */
function copyBaseFiles(passon) {
    debug('[%s] Copying base files ...', passon.id);
    return new Promise((fulfill, reject) => {
        let substFiles = passon.metadata.substitution.substitutionFiles;
        // check if aray substifutionFiles is not null
        if (Number.isInteger(substFiles.length) && substFiles.length > 0) {
            for (var i=0; i<=substFiles.length; i++) {
                if (i==substFiles.length) {
                    try {
                        debug('[%s] Running copy base files', passon.id);
                        fse.copySync(passon.basePath, passon.substitutedPath);
                        debug('[%s] Finished copy base files', passon.id);
                        fulfill(passon);
                    } catch(err) {
                        debug('Error copying base files to directory of new compendium - err:\n%s', err);
                        cleanup(passon);
                        err.status = 400;
                        err.msg = 'could not copy base files - base path does not exist';
                        reject(err);
                    }
                } else {
                    let basefile = passon.basePath + '/' + substFiles[i].base;
                    try {
                        // check if base filename exists in substitutionFiles
                        if (substFiles[i].base == undefined || typeof(substFiles[i].base) != 'string' || substFiles[i].base == '') {
                            debug('[%s] Error copying overlay files to directory of new compendium.', passon.id);
                            cleanup(passon);
                            let err = new Error ();
                            err.status = 400;
                            err.msg = 'substitution base file does not exist';
                            reject(err);
                        } else {
                            // check if overlay filename exists in substitutionFiles
                            if (substFiles[i].overlay == undefined || typeof(substFiles[i].overlay) != 'string' || substFiles[i].overlay == '') {
                                debug('[%s] Error copying overlay files to directory of new compendium.', passon.id);
                                cleanup(passon);
                                let err = new Error ();
                                err.status = 400;
                                err.msg = 'substitution overlay file does not exist';
                                reject(err);
                            } else {
                                // check if base file exists in base path
                                if (!fse.existsSync(basefile)) {
                                    debug('[%s] Base file does not exist - err:\n%s', passon.id);
                                    let err = new Error();
                                    cleanup(passon);
                                    err.status = 400;
                                    err.msg = 'base file does not exist';
                                    reject(err);
                                } else {
                                    debug('[%s] base file - %s - does exist', passon.id, substFiles[i].base);
                                }
                            } // end if - does overlay file exist?
                        } // end if - does base file exist?
                    } catch(err) {
                        debug('Error copying base files to directory of new compendium - err:\n%s', err);
                        cleanup(passon);
                        err.status = 400;
                        err.msg = 'could not copy base files - base path does not exist';
                        reject(err);
                    }
                }
            } // end for
        } else {
            debug('[%s] Error copying overlay files to directory of new compendium.', passon.id);
            cleanup(passon);
            let err = new Error ();
            err.status = 400;
            err.msg = 'substitution files do not exist';
            reject(err);
        } // end if - does substitutionFiles array exist
    });
}

/**
 * function to copy overlay files for new compendium
 * @param {object} passon - new compendium id and data of origin compendia
 */
function copyOverlayFiles(passon) {
    debug('[%s] Copying overlay files ...', passon.id);

    return new Promise((fulfill, reject) => {
        let substFiles = passon.metadata.substitution.substitutionFiles;
        debug('[%s] Running copy overlay files [%s] time(s) ...', passon.id, substFiles.length);
        try {
            for (var i=0; i<=substFiles.length; i++) {
                if (i==substFiles.length) {
                    // execute only if the last file is mounted
                    debug('[%s] Finished copy overlay files.\n', passon.id);
                    fulfill(passon);
                } else {
                    if (substFiles[i].overlay.indexOf("/") == 0) {
                        substFiles[i].overlay = substFiles[i].overlay.substring(1);
                    }
                    let overlayFilePath = substFiles[i].overlay;
                    let prefix = '';
                    if (overlayFilePath.lastIndexOf("/") >= 0) {
                        let splitter = overlayFilePath.lastIndexOf("/") + 1;
                        prefix = overlayFilePath.substring(0, splitter);
                        overlayFilePath =  overlayFilePath.substring(splitter);
                    }
                    try {
                        let overlayfile = passon.overlayPath + '/' + overlayFilePath;
                        let substoverlayfile = passon.substitutedPath + '/' + substFiles[i].overlay;
                        if (fse.existsSync(substoverlayfile)) {
                            let newoverlayfilename = prefix + 'overlay_' + overlayFilePath;
                            let newoverlayfilepath = passon.substitutedPath + '/' + newoverlayfilename;
                            fse.copySync(overlayfile, newoverlayfilepath);
                            substFiles[i].filename = newoverlayfilename;
                        } else {
                            let newoverlayfilepath = passon.substitutedPath + '/' + prefix + overlayFilePath;
                            fse.copySync(overlayfile, newoverlayfilepath);
                        }
                    } catch(err) {
                        debug('[%s] Error copying overlay files to directory of new compendium - err:\n%s', passon.id, err);
                        cleanup(passon);
                        err.status = 400;
                        err.msg = 'overlay file does not exist';
                        reject(err);
                    }
                    debug('[%s] copied files: %s', passon.id, (i+1));
                } // end copying files
            } // end for
        } catch (err) {
            debug('[%s] Error copying overlay files to directory of new compendium - err:\n%s', passon.id, err);
            cleanup(passon);
            err.status = 400;
            err.msg = 'overlay file does not exist';
            reject(err);
        }
    });
}

/**
 * function to save new compendium to mongodb
 * @param {object} passon - new compendium id and data of origin compendia
 */
function saveToDB(passon) {
    return new Promise((fulfill, reject) => {
        debug('[%s] Saving new compendium ...', passon.id);
        var metadataToSave = {};
        metadataToSave = passon.baseMetaData;
        metadataToSave.substituted = passon.metadata.substituted;
        metadataToSave.substitution = passon.metadata.substitution;
        var compendium = new Compendium({
            id: passon.id,
            user: passon.user,
            metadata: metadataToSave
        });

        compendium.save(error => {
            if (error) {
                debug('[%s] ERROR saving new compendium for user: %s', passon.id, passon.user);
                cleanup(passon);
                error.msg = JSON.stringify({ error: 'internal error' });
                error.status = 500;
                reject(error);
            } else {
                debug('[%s] Saved new compendium for user: %s.', passon.id, passon.user);
                fulfill(passon);
            }
        });
    });
}

/**
 * function to create docker image
 * @param {object} passon - compendium id and data of compendia
 */
 function createDockerImage(passon) {
    return new Promise((fulfill, reject) => {
      debug('[%s] Creating docker image ...', passon.id);
      let imagetitle = 'subst' + passon.id;
      imagetitle = "bagtainer:" + imagetitle.toLowerCase();

      // setup Docker client with default options
      var docker = new Docker();
      // debug('[%s] Docker client set up: %s', passon.id, JSON.stringify(docker));
      debug('[%s] Docker client set up.', passon.id);

      docker.buildImage({
        context: passon.substitutedPath,
        src: ['Dockerfile', "main.Rmd", "BerlinMit.csv", "erc.yml"]
      }, {t: imagetitle}, function (err, response) {
          if (err) {
              cleanup(passon);
              debug(err)
          }
          debug('# \n # \n Creating docker  image finished. \n # \n #');
          passon.docker = {};
          passon.docker.imageTag = imagetitle;
          fulfill(passon);
      });

  });
 }

/**
 * function to start docker container
 * @param {object} passon - compendium id and data of compendia
 */
 function startDockerContainer(passon) {
    return new Promise((fulfill, reject) => {

        // setup Docker client with default options
        var docker = new Docker();
        // debug('Docker client set up: %s', JSON.stringify(docker));
        debug('[%s] Starting docker container ...');
        if (!passon.docker.imageTag) {
            debug('[%s] image tag was not passed.');
            cleanup(passon);
            reject(new Error('image tag was not passed on!'));
        }

        debug('[%s] Starting docker container with image [%s] ...',passon.id, passon.docker.imageTag);
        let substFiles = passon.metadata.substitution.substitutionFiles;
        let o2rPath = passon.substitutedPath + '/';
        // for running docker
        let containerBinds = new Array();
        let baseBind = config.fs.compendium + passon.id + '/data' + ":" + "/erc";
        containerBinds.push(baseBind);
        // for erc.yml
        let cmdBinds = new Array();
        let cmdBaseBind = "-v " + baseBind;
        cmdBinds.push(cmdBaseBind);
        for (let i=0; i< substFiles.length; i++) {
            let bind = o2rPath + substFiles[i].filename + ":" + "/erc/" + substFiles[i].base + ":ro";
            containerBinds.push(bind);
            let cmdBind = "-v " + bind;
            cmdBinds.push(cmdBind);
        }
        passon.docker.binds = containerBinds;
        passon.yaml = {};
        passon.yaml.binds = cmdBinds;

        if (!passon.docker.binds) {
            debug('[%s] volume binds were not passed.');
            cleanup(passon);
            reject(new Error('volume binds were not passed!'));
        } else {
            debug('Run docker image with binds: \n%s', JSON.stringify(passon.docker.binds));
/*
            let create_options = clone(config.bagtainer.docker.create_options);
            let start_options = clone(config.bagtainer.docker.start_options);
            debug('Starting Docker container now with options:\n\tcreate_options: %s\n\tstart_options: %s', JSON.stringify(create_options), JSON.stringify(start_options));

            docker.run(passon.docker.imageTag, [], process.stdout, {
              "HostConfig": {
                "Binds": containerBinds
              }
            }).then(function(container) {
                debug('Container StatusCode: %s', container.output.StatusCode);
                if (container.output.StatusCode === 0) {
                    debug('[%s] Creating container finished.', passon.id);
                    passon.docker.containerID = container.id;
                    debug('removing container %s ...', container.id);
                    return container.remove();
                }
            }).then(function(data) {
                // data === "" --> typeof(data) === String
                debug('Container has been removed');
                fulfill(passon);
            }).catch(function(err) {
                debug('[DOCKER] error: %s', err);
                container.remove();
                cleanup(passon);
                reject(new Error(err));
            });
*/
            fulfill(passon);
        }
    });
 }

 /**
  * function for cleanup after error is detected
  * @param {object} passon - compendium id and data of compendia
  */
 function cleanup(passon) {
    debug('[%s] Starting cleanup ...', passon.id);
    try {
        debug('[%s] Cleanup running ...', passon.id);
        let cleanupPath = path.join(config.fs.compendium, passon.id);
        fse.removeSync(cleanupPath);
        debug('[%s] Finished cleanup.', passon.id);
      } catch (err) {
        debug(err);
        debug('Cleanup not successfull.');
      }
 };

 /**
  * function to read erc.yml and overwrite with execution command for "docker run"
  * @param {object} passon - compendium id and data of compendia
  */
 function writeYaml(passon) {
   return new Promise((fulfill, reject) => {
      debug('[%s] Starting write yaml ...', passon.id);
       try {
          let yamlPath = passon.substitutedPath + '/erc.yml';
          let dockerCmd = "docker run -it --rm";
          let yamlBinds = passon.yaml.binds;
          for (let i=0; i<yamlBinds.length; i++) {
              dockerCmd = dockerCmd + " " + passon.yaml.binds[i];
          }
          let doc = yaml.safeLoad(fse.readFileSync(yamlPath, 'utf8'));
          debug('[%s] Old erc.yml file: \n %s', passon.id, yaml.dump(doc));
          if (!doc.execution) {
              doc.execution = {};
          }
          doc.execution.cmd = "'" + dockerCmd + " " + passon.docker.imageTag + "'";
          debug('[%s] New erc.yml file: \n %s', passon.id, yaml.dump(doc));
          writeyaml.sync(yamlPath, doc, function(err) {
              debug("[%s] Error writing erc.yml in: %s \n err: %s", passon.id, yamlPath, err);
              cleanup(passon);
              reject("Error writing erc.yml in: %s", yamlPath);
          });
          fulfill(passon);
     } catch(err) {
          debug("[%s] Error writing erc.yml - err: %s", passon.id, err);
          cleanup(passon);
          reject("Error writing erc.yml in: %s", yamlPath);
     }
   })
 };

module.exports = {
    // checkNewId: checkNewId,
    getMetadata: getMetadata,
    checkOverlayId: checkOverlayId,
    createFolder: createFolder,
    copyBaseFiles: copyBaseFiles,
    copyOverlayFiles: copyOverlayFiles,
    saveToDB: saveToDB,
    createDockerImage: createDockerImage,
    startDockerContainer: startDockerContainer,
    cleanup: cleanup,
    writeYaml: writeYaml
};
