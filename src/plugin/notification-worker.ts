import type ReminderPlugin from "main";
import type { Reminder } from "model/reminder";
import { Notice } from "obsidian";

export class NotificationWorker {
  private lastAuthenticationAttempt: number = 0;
  private readonly AUTH_ATTEMPT_INTERVAL = 5 * 60 * 1000; // 5 minutes

  constructor(private plugin: ReminderPlugin) {}

  startPeriodicTask() {
    let intervalTaskRunning = true;
    // Force the view to refresh as soon as possible.
    this.periodicTask().finally(() => {
      intervalTaskRunning = false;
    });

    // Set up the recurring check for reminders.
    this.plugin.registerInterval(
      window.setInterval(() => {
        if (intervalTaskRunning) {
          console.log(
            "Skip reminder interval task because task is already running.",
          );
          return;
        }
        intervalTaskRunning = true;
        this.periodicTask().finally(() => {
          intervalTaskRunning = false;
        });
      }, this.plugin.settings.reminderCheckIntervalSec.value * 1000),
    );
  }

  private async periodicTask(): Promise<void> {
    this.plugin.ui.reload(false);

    if (!this.plugin.data.scanned.value) {
      this.plugin.fileSystem.reloadRemindersInAllFiles().then(() => {
        this.plugin.data.scanned.value = true;
        this.plugin.data.save();
      });
    }

    // Check Google Tasks authentication status if integration is enabled
    this.checkGoogleTasksAuthStatus();

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
          // We don't want to set `previousReminder` in this case as the current
          // reminder won't be shown.
          continue;
        }
        if (previousReminder) {
          while (previousReminder.beingDisplayed) {
            // Displaying too many reminders at once can cause crashes on
            // mobile. We use `beingDisplayed` to wait for the current modal to
            // be dismissed before displaying the next.
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
          this.lastAuthenticationAttempt = now;

          // Create an actionable notice with multiple options
          const notice = new Notice(
            "Google Tasks integration requires authentication. Click this message for options.",
            10000, // 10 second duration
          );

          // Add click handler to show options
          if (notice.noticeEl) {
            notice.noticeEl.addEventListener("click", () => {
              // Remove this notice when clicked
              notice.hide();

              // Create two separate notices for the actions
              const authenticateNotice = new Notice(
                "▶️ Authenticate with Google Tasks",
                15000,
              );

              const disableNotice = new Notice(
                "❌ Disable Google Tasks integration",
                15000,
              );

              // Add click handlers to each notice
              if (authenticateNotice.noticeEl) {
                authenticateNotice.noticeEl.addEventListener("click", () => {
                  authenticateNotice.hide();
                  disableNotice.hide();
                  this.plugin.authenticateWithGoogleTasks();
                });
              }

              if (disableNotice.noticeEl) {
                disableNotice.noticeEl.addEventListener("click", () => {
                  authenticateNotice.hide();
                  disableNotice.hide();
                  this.plugin.settings.enableGoogleTasks.rawValue.value = false;
                  new Notice(
                    "Google Tasks integration has been disabled",
                    3000,
                  );
                });
              }
            });
          }
        }
      }
    } catch (error) {
      console.error(
        "Error checking Google Tasks authentication status:",
        error,
      );
    }
  }

  /* An asynchronous sleep function. To use it you must `await` as it hands
   * off control to other portions of the JS control loop whilst waiting.
   *
   * @param milliseconds - The number of milliseconds to wait before resuming.
   */
  private async sleep(milliseconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }
}
