const cron = require('node-cron');
const logger = require('./logger');
const backupService = require('../services/backupService');

let scheduledTask = null;

/**
 * Converts HH:MM string (e.g. "20:00" or "02:30") to cron expression
 */
function timeToCron(timeStr, frequency = 'daily') {
  if (!timeStr || !timeStr.includes(':')) {
    return '0 2 * * *'; // Default 2:00 AM daily
  }
  const [hourStr, minStr] = timeStr.split(':');
  const hour = parseInt(hourStr, 10) || 0;
  const minute = parseInt(minStr, 10) || 0;

  if (frequency === 'weekly') {
    return `${minute} ${hour} * * 0`; // Every Sunday
  }
  return `${minute} ${hour} * * *`; // Every day
}

/**
 * Start the automated backup job dynamically from settings.
 */
async function startBackupJob() {
  try {
    const settings = await backupService.getBackupSettings();
    if (!settings.auto_backup_enabled) {
      logger.info('Automated daily backup is currently disabled in settings.');
      return;
    }

    const cronExpr = timeToCron(settings.auto_backup_time, settings.auto_backup_frequency);
    if (scheduledTask) {
      scheduledTask.stop();
    }

    scheduledTask = cron.schedule(cronExpr, async () => {
      logger.info(`Starting scheduled automated database backup (${settings.auto_backup_time})...`);
      try {
        await backupService.createBackup();
      } catch (error) {
        logger.error('Failed to run automated database backup:', error);
      }
    });

    logger.info(`✅ Automated database backup scheduled at ${settings.auto_backup_time} (${settings.auto_backup_frequency}) [Cron: ${cronExpr}]`);
  } catch (err) {
    logger.error('Failed to initialize automated backup job:', err);
  }
}

/**
 * Reschedule the backup job immediately when settings change.
 */
async function rescheduleBackupJob() {
  if (scheduledTask) {
    scheduledTask.stop();
    scheduledTask = null;
  }
  await startBackupJob();
}

module.exports = { startBackupJob, rescheduleBackupJob, timeToCron };
