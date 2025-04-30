import type ReminderPlugin from "main";
import type { Reminder } from "model/reminder";

export class NotificationWorker {
  private lastAuthenticationAttempt: number = 0;
  private readonly AUTH_ATTEMPT_INTERVAL = 5 * 60 * 1000; // 5 minutes
  private lastGoogleSyncTimestamp: number = 0; // Timestamp of the last sync start
  private readonly GOOGLE_SYNC_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

  constructor(private plugin: ReminderPlugin) {}

  startPeriodicTask() {
    const interval = this.plugin.settings.reminderCheckIntervalSec.value;
    console.log(
      `Starting periodic task with interval=${interval} sec for reminders and Google Sync check.`,
    );
    if (interval === 0) {
      return;
    }
    const periodicTask = async () => {
      await this.periodicTask();
      setTimeout(periodicTask, interval * 1000);
    };
    setTimeout(periodicTask, interval * 1000);
  }

  stopPeriodicTask() {
    // Implementation depends on how setTimeout is tracked, assume it's handled elsewhere or not needed for this snippet
    console.log("Stopping periodic task...");
  }

  private async sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async periodicTask(): Promise<void> {
    this.plugin.ui.reload(false);

    if (!this.plugin.data.scanned.value) {
      console.log("Periodic task: performing initial scan.");
      this.plugin.fileSystem.reloadRemindersInAllFiles().then(() => {
        this.plugin.data.scanned.value = true;
        this.plugin.data.save();
      });
    }

    this.plugin.data.save(false);

    if (this.plugin.ui.isEditing()) {
      return;
    }
    const expired = this.plugin.reminders.getExpiredReminders(
      this.plugin.settings.reminderTime.value,
    );

    let previousReminder: Reminder | undefined = undefined;
    for (const reminder of expired) {
      if (this.plugin.app.workspace.layoutReady) {
        if (reminder.muteNotification) {
          continue;
        }
        if (previousReminder) {
          while (previousReminder.beingDisplayed) {
            await this.sleep(100);
          }
        }
        this.plugin.ui.showReminder(reminder);
        previousReminder = reminder;
      }
    }

    if (this.plugin.settings.enableGoogleTasks.value) {
      const now = Date.now();
      if (now - this.lastGoogleSyncTimestamp > this.GOOGLE_SYNC_INTERVAL_MS) {
        console.log("Periodic check: Google Tasks sync interval elapsed.");
        this.lastGoogleSyncTimestamp = now;
        try {
          console.log("Initiating automatic Google Tasks sync...");
          this.plugin.syncGoogleTasks().catch((syncError) => {
            console.error(
              "Caught unexpected error from background syncGoogleTasks:",
              syncError,
            );
          });
        } catch (error) {
          console.error(
            "Unexpected error trying to start syncGoogleTasks:",
            error,
          );
        }
      }
    }
  }

  /**
   * Process expired reminders and show notifications.
   */
  private async processExpiredReminders(): Promise<void> {
    const expired = this.plugin.reminders.getExpiredReminders(
      this.plugin.settings.reminderTime.value,
    );

    let previousReminder: Reminder | undefined = undefined;
    for (const reminder of expired) {
      if (this.plugin.app.workspace.layoutReady) {
        if (reminder.muteNotification) {
          continue;
        }
        if (previousReminder) {
          while (previousReminder.beingDisplayed) {
            await this.sleep(100);
          }
        }
        this.plugin.ui.showReminder(reminder);
        previousReminder = reminder;
      }
    }
  }

  /**
   * Check if Google Tasks integration is enabled and user is authenticated.
   * If integration is enabled but user is not authenticated, prompt for authentication
   * but limit prompts to avoid annoying the user too frequently.
   * @deprecated This logic is now handled within syncGoogleTasks/ensureGoogleTasksAuthenticated
   */
  private checkGoogleTasksAuthStatus(): void {
    // Only check if Google Tasks integration is enabled
    if (!this.plugin.settings.enableGoogleTasks.value) {
      return;
    }

    try {
      // Get the Google Tasks service
      const googleTasksService = (this.plugin as any)._googleTasksService;

      // Check if user is not authenticated and we haven't recently prompted
      if (googleTasksService && !googleTasksService.isAuthenticated()) {
        const now = Date.now();

        // Ensure we don't prompt too frequently
        if (now - this.lastAuthenticationAttempt > this.AUTH_ATTEMPT_INTERVAL) {
          console.log(
            "Periodic check: Google Tasks enabled but not authenticated. Prompting (throttled).",
          );
          this.lastAuthenticationAttempt = now;
        }
      }
    } catch (error) {
      console.error("Error checking Google Tasks auth status:", error);
    }
  }
}
