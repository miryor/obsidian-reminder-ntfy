import {
  NotificationWorker,
  PluginData,
  ReminderPluginFileSystem,
  ReminderPluginUI,
} from "plugin";
import { Reminders } from "model/reminder";
import { DATE_TIME_FORMATTER } from "model/time";
import { App, Modal, Notice, Plugin, Setting, TFile } from "obsidian";
import type { PluginManifest } from "obsidian";
import { GoogleTasksService } from "plugin/google-tasks";
import type { Task } from "plugin/google-tasks";
import {
  convertObsidianToGoogleTask,
  extractGoogleTaskMetadata,
  generateReminderChecksum,
} from "plugin/google-tasks-converter";
import type { GoogleTaskMetadata } from "plugin/google-tasks-converter";

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

  /**
   * Verify Google Tasks authentication by fetching task lists
   */
  public async verifyGoogleTasksAuth(): Promise<void> {
    try {
      if (!this._googleTasksService.isAuthenticated()) {
        new Notice(
          "Not authenticated with Google Tasks. Please authenticate first.",
          3000,
        );
        return;
      }

      const taskLists = await this._googleTasksService.getTaskLists();
      console.log(
        "Google Tasks authentication verified. Available task lists:",
        taskLists,
      );
      new Notice(
        `Successfully fetched ${taskLists.length} task lists from Google Tasks.`,
        3000,
      );
    } catch (error) {
      console.error("Error verifying Google Tasks authentication:", error);
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      new Notice(
        `Failed to verify Google Tasks authentication: ${errorMessage}`,
        5000,
      );
    }
  }

  /**
   * Get Google Tasks task list by name, creating it if it doesn't exist
   */
  public async getGoogleTasksList(): Promise<void> {
    try {
      if (!this._googleTasksService.isAuthenticated()) {
        new Notice(
          "Not authenticated with Google Tasks. Please authenticate first.",
          3000,
        );
        return;
      }

      const listName = this.settings.googleTasksListName.value;
      let taskList = await this._googleTasksService.getTaskListByName(listName);

      if (taskList) {
        console.log(`Found task list "${listName}":`, taskList);
      } else {
        console.log(`Task list "${listName}" not found. Creating it...`);
        try {
          taskList = await this._googleTasksService.createTaskList(listName);
          console.log(
            `Successfully created task list "${listName}":`,
            taskList,
          );
          new Notice(`Task list "${listName}" created in Google Tasks.`, 3000);
        } catch (createError) {
          console.error(
            `Failed to create task list "${listName}":`,
            createError,
          );
          const errorMessage =
            createError instanceof Error
              ? createError.message
              : String(createError);
          new Notice(`Failed to create task list: ${errorMessage}`, 5000);
          return;
        }
      }

      // Fetch detailed information about the task list
      const detailedTaskList = await this._googleTasksService.getTaskList(
        taskList.id,
      );
      console.log(
        `Detailed information for task list "${listName}":`,
        detailedTaskList,
      );

      new Notice(
        `Successfully fetched task list "${listName}" from Google Tasks.`,
        3000,
      );
    } catch (error) {
      console.error("Error getting Google Tasks task list:", error);
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      new Notice(`Failed to get Google Tasks task list: ${errorMessage}`, 5000);
    }
  }

  /**
   * Manually refresh the Google Tasks access token
   * This is useful if the token has expired but the automatic refresh hasn't triggered
   */
  public async refreshGoogleTasksToken(): Promise<void> {
    try {
      if (!this._googleTasksService.isAuthenticated()) {
        new Notice(
          "Not authenticated with Google Tasks. Please authenticate first.",
          3000,
        );
        return;
      }

      // Call the internal refresh method
      await this._googleTasksService.refreshAccessToken();
      new Notice("Google Tasks token has been refreshed successfully.", 3000);
    } catch (error) {
      console.error("Error refreshing Google Tasks token:", error);
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      new Notice(`Failed to refresh Google Tasks token: ${errorMessage}`, 5000);
    }
  }

  /**
   * Get and print tasks from the configured Google Tasks list
   * Retrieves all tasks from the list specified in settings and prints them to the console
   */
  public async getGoogleTasks(): Promise<void> {
    try {
      if (!this._googleTasksService.isAuthenticated()) {
        new Notice(
          "Not authenticated with Google Tasks. Please authenticate first.",
          3000,
        );
        return;
      }

      const listName = this.settings.googleTasksListName.value;
      let taskList = await this._googleTasksService.getTaskListByName(listName);

      if (!taskList) {
        console.log(`Task list "${listName}" not found. Creating it...`);
        try {
          taskList = await this._googleTasksService.createTaskList(listName);
          console.log(
            `Successfully created task list "${listName}":`,
            taskList,
          );
        } catch (createError) {
          console.error(
            `Failed to create task list "${listName}":`,
            createError,
          );
          const errorMessage =
            createError instanceof Error
              ? createError.message
              : String(createError);
          new Notice(`Failed to create task list: ${errorMessage}`, 5000);
          return;
        }
      }

      // Get tasks from the list
      const tasks = await this._googleTasksService.getTasks(taskList.id);

      // Log tasks to console
      console.log(
        `Tasks in list "${listName}" (${tasks.length} tasks):`,
        tasks,
      );

      // Format and log each task in a more readable way
      if (tasks.length > 0) {
        console.log(`===== Tasks in "${listName}" =====`);
        tasks.forEach((task, index) => {
          console.log(
            `${index + 1}. ${task.title} (${task.status || "no status"})`,
          );
          if (task.notes) console.log(`   Notes: ${task.notes}`);
          if (task.due)
            console.log(`   Due: ${new Date(task.due).toLocaleString()}`);
          if (task.completed)
            console.log(
              `   Completed: ${new Date(task.completed).toLocaleString()}`,
            );
          console.log("   ---");
        });
      } else {
        console.log(`No tasks found in list "${listName}"`);
      }

      new Notice(
        `Retrieved ${tasks.length} tasks from Google Tasks list "${listName}". Check developer console for details.`,
        3000,
      );
    } catch (error) {
      console.error("Error getting Google Tasks:", error);
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      new Notice(`Failed to get Google Tasks: ${errorMessage}`, 5000);
    }
  }

  /**
   * Core logic to synchronize Obsidian reminders with Google Tasks.
   * Iterates through reminders, compares checksums, and creates/updates tasks as needed.
   */
  public async syncGoogleTasks(): Promise<void> {
    if (!this.settings.enableGoogleTasks.value) {
      new Notice("Google Tasks integration is disabled in settings.", 3000);
      return;
    }

    if (!this._googleTasksService.isAuthenticated()) {
      new Notice(
        "Not authenticated with Google Tasks. Please authenticate first.",
        3000,
      );
      return;
    }

    console.log("Starting Google Tasks synchronization...");
    new Notice("Starting Google Tasks sync...");

    let createdCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    try {
      const listName = this.settings.googleTasksListName.value;
      let taskList = await this._googleTasksService.getTaskListByName(listName);

      if (!taskList) {
        console.log(`Task list "${listName}" not found. Creating it...`);
        try {
          taskList = await this._googleTasksService.createTaskList(listName);
          console.log(
            `Successfully created task list "${listName}":`,
            taskList,
          );
        } catch (createError) {
          console.error(
            `Failed to find or create task list "${listName}":`,
            createError,
          );
          const errorMessage =
            createError instanceof Error
              ? createError.message
              : String(createError);
          new Notice(
            `Failed to find/create Google Tasks list: ${errorMessage}`,
            5000,
          );
          return;
        }
      }
      const targetListId = taskList.id;

      // Correctly access the reminders array
      const obsidianReminders = this._reminders.reminders;
      console.log(
        `Found ${obsidianReminders.length} Obsidian reminders to process.`,
      );

      for (const reminder of obsidianReminders) {
        try {
          if (!reminder.file) {
            console.warn(
              "Skipping reminder with no file path:",
              reminder.title,
            );
            skippedCount++;
            continue;
          }

          const file = this.app.vault.getAbstractFileByPath(reminder.file);
          if (!(file instanceof TFile)) {
            console.warn(
              "Skipping reminder for non-existent file:",
              reminder.file,
            );
            skippedCount++;
            continue;
          }

          const fileContent = await this.app.vault.read(file);
          const lines = fileContent.split("\n");
          if (reminder.rowNumber >= lines.length) {
            console.warn(
              `Skipping reminder: Line number ${reminder.rowNumber} out of bounds for file ${reminder.file}`,
            );
            skippedCount++;
            continue;
          }
          const reminderLine = lines[reminder.rowNumber];

          // Add check for undefined reminderLine before processing
          if (reminderLine === undefined) {
            console.warn(
              `Skipping reminder: Could not read line ${reminder.rowNumber} from file ${reminder.file}`,
            );
            skippedCount++;
            continue;
          }

          const existingMetadata = extractGoogleTaskMetadata(reminderLine);
          const currentChecksum = generateReminderChecksum(reminder);
          const taskInput = convertObsidianToGoogleTask(reminder);
          let updatedMetadata: GoogleTaskMetadata | null = null;

          if (existingMetadata) {
            if (existingMetadata.checksum === currentChecksum) {
              skippedCount++;
              continue;
            } else {
              console.log(
                `Updating task: ${reminder.title} (ID: ${existingMetadata.id})`,
              );
              await this._googleTasksService.updateTask(
                targetListId,
                existingMetadata.id,
                taskInput,
              );
              updatedMetadata = {
                id: existingMetadata.id,
                checksum: currentChecksum,
              };
              updatedCount++;
            }
          } else {
            console.log(`Creating new task: ${reminder.title}`);
            const createdTask: Task = await this._googleTasksService.createTask(
              targetListId,
              taskInput,
            );
            updatedMetadata = { id: createdTask.id, checksum: currentChecksum };
            createdCount++;
          }

          if (updatedMetadata) {
            const updatedLine = this.updateMarkdownLineWithMetadata(
              reminderLine,
              updatedMetadata,
            ); // reminderLine is now guaranteed to be a string
            if (updatedLine !== reminderLine) {
              lines[reminder.rowNumber] = updatedLine;
              await this.app.vault.modify(file, lines.join("\n"));
              console.log(`Updated markdown for task: ${reminder.title}`);
            } else {
              console.warn(
                `Failed to update markdown comment for task: ${reminder.title}`,
              );
            }
          }
        } catch (individualError) {
          console.error(
            `Error processing reminder "${reminder.title}" in file ${reminder.file}:`,
            individualError,
          );
          errorCount++;
        }
      }

      console.log("Google Tasks synchronization finished.");
      new Notice(
        `Google Tasks Sync Complete: ${createdCount} created, ${updatedCount} updated, ${skippedCount} skipped, ${errorCount} errors.`,
        5000,
      );
    } catch (error) {
      console.error("Error during Google Tasks synchronization:", error);
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      new Notice(`Google Tasks Sync Failed: ${errorMessage}`, 5000);
    }
  }

  /**
   * Updates a markdown line to include or replace the gtask metadata comment.
   * @param originalLine The original markdown line content.
   * @param metadata The metadata (id and checksum) to embed.
   * @returns The updated markdown line.
   */
  private updateMarkdownLineWithMetadata(
    originalLine: string,
    metadata: GoogleTaskMetadata,
  ): string {
    // Remove existing gtask comment if present
    const lineWithoutComment = originalLine
      .replace(/<!--\s*gtask:.*?\s*-->/g, "")
      .trimEnd();

    // Construct the new comment
    const metadataString = JSON.stringify(metadata);
    const newComment = ` <!-- gtask:${metadataString} -->`;

    return lineWithoutComment + newComment;
  }
}
