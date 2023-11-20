import { app } from 'electron';
import { autoUpdater } from 'electron-updater';

import { isMacOS, isWindows } from '../../shared/utils';
import { buildType } from '../config';
import { logger } from '../logger';
import { CustomGitHubProvider } from './custom-github-provider';
import { updaterSubjects } from './event';

const mode = process.env.NODE_ENV;
const isDev = mode === 'development';

// skip auto update in dev mode & internal
const disabled = buildType === 'internal' || isDev;

export const quitAndInstall = async () => {
  autoUpdater.quitAndInstall();
};

let lastCheckTime = 0;
export const checkForUpdates = async (force = true) => {
  // check every 30 minutes (1800 seconds) at most
  if (!disabled && (force || lastCheckTime + 1000 * 1800 < Date.now())) {
    lastCheckTime = Date.now();
    return await autoUpdater.checkForUpdates();
  }
  return void 0;
};

export const registerUpdater = async () => {
  if (disabled) {
    return;
  }

  // TODO: support auto update on linux
  const allowAutoUpdate = isMacOS() || isWindows();

  autoUpdater.logger = logger;
  autoUpdater.autoDownload = false;
  autoUpdater.allowPrerelease = buildType !== 'stable';
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.autoRunAppAfterInstall = true;

  const feedUrl: Parameters<typeof autoUpdater.setFeedURL>[0] = {
    channel: buildType,
    // hack for custom provider
    provider: 'custom' as 'github',
    repo: buildType !== 'internal' ? 'AFFiNE' : 'AFFiNE-Releases',
    owner: 'toeverything',
    releaseType: buildType === 'stable' ? 'release' : 'prerelease',
    // @ts-expect-error hack for custom provider
    updateProvider: CustomGitHubProvider,
  };

  logger.debug('auto-updater feed config', feedUrl);

  autoUpdater.setFeedURL(feedUrl);

  // register events for checkForUpdatesAndNotify
  autoUpdater.on('checking-for-update', () => {
    logger.info('Checking for update');
  });
  let downloading = false;
  autoUpdater.on('update-available', info => {
    logger.info('Update available', info);
    if (allowAutoUpdate && !downloading) {
      downloading = true;
      autoUpdater?.downloadUpdate().catch(e => {
        downloading = false;
        logger.error('Failed to download update', e);
      });
      logger.info('Update available, downloading...', info);
    }
    updaterSubjects.updateAvailable.next({
      version: info.version,
      allowAutoUpdate,
    });
  });
  autoUpdater.on('update-not-available', info => {
    logger.info('Update not available', info);
  });
  autoUpdater.on('download-progress', e => {
    logger.info(`Download progress: ${e.percent}`);
    updaterSubjects.downloadProgress.next(e.percent);
  });
  autoUpdater.on('update-downloaded', e => {
    downloading = false;
    updaterSubjects.updateReady.next({
      version: e.version,
      allowAutoUpdate,
    });
    // I guess we can skip it?
    // updaterSubjects.clientDownloadProgress.next(100);
    logger.info('Update downloaded, ready to install');
  });
  autoUpdater.on('error', e => {
    logger.error('Error while updating client', e);
  });
  autoUpdater.forceDevUpdateConfig = isDev;

  app.on('activate', () => {
    checkForUpdates(false).catch(err => {
      console.error(err);
    });
  });
};
