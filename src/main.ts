import {
  NotificationWorker,
  PluginData,
  ReminderPluginFileSystem,
  ReminderPluginUI,
} from "plugin";
import { Reminders } from "model/reminder";
import { DATE_TIME_FORMATTER } from "model/time";
import { App, Modal, Notice, Plugin, Setting } from "obsidian";
import type { PluginManifest } from "obsidian";
import { GoogleTasksService } from "plugin/google-tasks";

/**
 * Modal for handling Google Tasks authentication failures
 */
class GoogleTasksAuthFailedModal extends Modal {
  constructor(
    private plugin: ReminderPlugin,
    private errorMessage: string,
  ) {
    super(plugin.app);
  }

  override onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h2", { text: "Google Tasks Authentication Failed" });

    contentEl.createEl("p", {
      text: "There was a problem authenticating with Google Tasks:",
    });

    contentEl.createEl("div", {
      text: this.errorMessage,
      cls: "google-tasks-error-message",
    }).style.color = "var(--text-error)";

    contentEl.createEl("p", {
      text: "What would you like to do?",
    });

    new Setting(contentEl)
      .addButton((btn) =>
        btn
          .setButtonText("Try Again")
          .setCta()
          .onClick(() => {
            this.close();
            this.plugin.authenticateWithGoogleTasks();
          }),
      )
      .addButton((btn) =>
        btn.setButtonText("Disable Google Tasks").onClick(() => {
          this.close();
          this.plugin.settings.enableGoogleTasks.rawValue.value = false;
          new Notice("Google Tasks integration has been disabled", 3000);
        }),
      );
  }

  override onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}

export default class ReminderPlugin extends Plugin {
  _data: PluginData;
  private _ui: ReminderPluginUI;
  private _reminders: Reminders;
  private _fileSystem: ReminderPluginFileSystem;
  private _notificationWorker: NotificationWorker;
  private _googleTasksService: GoogleTasksService;
  private previousGoogleTasksEnabled: boolean = false;

  constructor(app: App, manifest: PluginManifest) {
    super(app, manifest);
    this._reminders = new Reminders(() => {
      // on changed
      if (this.ui) {
        this.ui.invalidate();
      }
      this.data.changed = true;
    });
    this._data = new PluginData(this, this.reminders);
    this.reminders.reminderTime = this.settings.reminderTime;
    DATE_TIME_FORMATTER.setTimeFormat(
      this.settings.dateFormat,
      this.settings.dateTimeFormat,
      this.settings.strictDateFormat,
    );

    this._ui = new ReminderPluginUI(this);
    this._fileSystem = new ReminderPluginFileSystem(
      app.vault,
      this.reminders,
      () => {
        this.ui.reload(true);
      },
    );
    this._googleTasksService = new GoogleTasksService(this);
    this._notificationWorker = new NotificationWorker(this);
  }

  override async onload() {
    this.ui.onload();
    this.app.workspace.onLayoutReady(async () => {
      await this.data.load();
      this.ui.onLayoutReady();
      this.fileSystem.onload(this);
      await this._googleTasksService.initialize();

      // Store initial state of Google Tasks integration
      this.previousGoogleTasksEnabled = this.settings.enableGoogleTasks.value;

      // Set up a watcher for the enableGoogleTasks setting
      this.settings.enableGoogleTasks.rawValue.onChanged(() => {
        const currentValue = this.settings.enableGoogleTasks.value;

        // If Google Tasks was just enabled, trigger authentication
        if (currentValue && !this.previousGoogleTasksEnabled) {
          this.authenticateWithGoogleTasks();
        }

        this.previousGoogleTasksEnabled = currentValue;
      });

      this._notificationWorker.startPeriodicTask();
    });
  }

  override onunload(): void {
    this.ui.onunload();
  }

  get reminders() {
    return this._reminders;
  }

  get ui() {
    return this._ui;
  }

  get fileSystem() {
    return this._fileSystem;
  }

  get data() {
    return this._data;
  }

  get settings() {
    return this.data.settings;
  }

  public async authenticateWithGoogleTasks(): Promise<void> {
    try {
      await this._googleTasksService.authorize();
      new Notice("Successfully authenticated with Google Tasks.", 3000);
    } catch (error: unknown) {
      console.error("Error authenticating with Google Tasks:", error);
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      // Open a modal with options to retry or disable Google Tasks
      new GoogleTasksAuthFailedModal(this, errorMessage).open();
    }
  }

  /**
   * Clear Google Tasks authentication data
   */
  public clearGoogleTasksAuth(): void {
    this._googleTasksService.clearTokenData();
    new Notice(
      "Google Tasks authentication has been cleared. You will need to re-authenticate.",
      5000,
    );
  }
}
