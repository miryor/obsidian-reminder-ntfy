import {
  NotificationWorker,
  PluginData,
  ReminderPluginFileSystem,
  ReminderPluginUI,
} from "plugin";
import { Reminder, Reminders } from "model/reminder";
import { DATE_TIME_FORMATTER } from "model/time";
import { App, Modal, Notice, Plugin, Setting, TFile } from "obsidian";
import type { PluginManifest } from "obsidian";
import { GoogleTasksService } from "plugin/google-tasks";
import type { Task, TaskInput } from "plugin/google-tasks";
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
   * Handles the synchronization logic for a reminder that has existing metadata (potentially exists in Google Tasks).
   * Fetches the task, checks if deleted, compares checksum, and updates or recreates as needed.
   * @returns An object indicating the outcome: { status: 'updated' | 'recreated' | 'skipped' | 'error', newMetadata?: GoogleTaskMetadata | null }
   */
  private async handleExistingTaskSync(
    reminder: Reminder,
    file: TFile,
    existingMetadata: GoogleTaskMetadata,
    currentChecksum: string,
    targetListId: string,
    taskInput: TaskInput,
    activeGoogleTasksMap: Map<string, Task>,
  ): Promise<{
    status: "updated" | "recreated" | "skipped" | "completedLocally" | "error";
    newMetadata?: GoogleTaskMetadata | null;
  }> {
    // Check if the task is in the active list fetched earlier
    const googleTask = activeGoogleTasksMap.get(existingMetadata.id);

    if (googleTask) {
      // Task exists and is active, compare checksums
      if (existingMetadata.checksum === currentChecksum) {
        return { status: "skipped" };
      }

      // Checksums differ, proceed with UPDATE
      try {
        console.log(
          `Updating task due to changed checksum: ${reminder.title} (ID: ${existingMetadata.id})`,
        );
        await this._googleTasksService.updateTask(
          targetListId,
          existingMetadata.id,
          taskInput,
        );
        const updatedMetadata = {
          id: existingMetadata.id,
          checksum: currentChecksum,
        };
        await this.updateReminderCommentInFile(reminder, file, updatedMetadata);
        return { status: "updated", newMetadata: updatedMetadata };
      } catch (updateError) {
        console.error(
          `Error during PATCH update for task ID ${existingMetadata.id} ("${reminder.title}"):`,
          updateError,
        );
        return { status: "error" };
      }
    } else {
      // Task NOT found in the active list - means it's completed or deleted in Google
      console.warn(
        `Task ID ${existingMetadata.id} ("${reminder.title}") not found in active Google Tasks list. Checking status...`,
      );
      return this.handlePotentiallyStaleLink(
        reminder,
        file,
        existingMetadata,
        targetListId,
        taskInput,
        currentChecksum,
      );
    }
  }

  /**
   * Handles a reminder whose linked Google Task ID was not found in the active task list.
   * Fetches the specific task to determine if it was completed or deleted, then takes appropriate action.
   */
  private async handlePotentiallyStaleLink(
    reminder: Reminder,
    file: TFile,
    existingMetadata: GoogleTaskMetadata,
    targetListId: string,
    taskInput: TaskInput,
    currentChecksum: string,
  ): Promise<{
    status: "recreated" | "completedLocally" | "error";
    newMetadata?: GoogleTaskMetadata | null;
  }> {
    try {
      const googleTask = await this._googleTasksService.getTask(
        targetListId,
        existingMetadata.id,
      );

      // Task was found, check its status
      if (googleTask.status === "completed") {
        console.log(
          `Task ID ${existingMetadata.id} ("${reminder.title}") was completed in Google Tasks. Marking as done locally.`,
        );
        // TODO: Implement logic to mark reminder as done in Obsidian
        // This might involve calling a file modification helper
        const completed = await this.handleCompleteObsidianReminder(
          reminder,
          file,
        );
        if (completed) {
          return { status: "completedLocally" }; // Maybe return updated metadata if checksum changes?
        } else {
          return { status: "error" }; // Error marking as done locally
        }
      } else {
        // Task exists but is not completed (unexpected state if not in active list, maybe deleted=true?)
        console.warn(
          `Task ID ${existingMetadata.id} ("${reminder.title}") has unexpected status '${googleTask.status}' or state. Recreating.`,
        );
        // Fall through to recreate logic as a safeguard
        return this.recreateGoogleTaskAndUpdateComment(
          reminder,
          file,
          targetListId,
          taskInput,
          currentChecksum,
        );
      }
    } catch (getError) {
      // Check if it was specifically a 404 error (meaning task was deleted)
      if (
        getError instanceof Error &&
        (getError.message.includes("404") ||
          getError.message.toLowerCase().includes("not found"))
      ) {
        console.warn(
          `Task ID ${existingMetadata.id} ("${reminder.title}") confirmed deleted (404). Recreating...`,
        );
        return this.recreateGoogleTaskAndUpdateComment(
          reminder,
          file,
          targetListId,
          taskInput,
          currentChecksum,
        );
      } else {
        // It was a different error during GET
        console.error(
          `Error fetching potentially stale task ID ${existingMetadata.id}:`,
          getError,
        );
        return { status: "error" };
      }
    }
  }

  /**
   * Marks an Obsidian reminder as complete in the markdown file.
   * TODO: Implement the actual markdown modification.
   */
  private async handleCompleteObsidianReminder(
    reminder: Reminder,
    file: TFile,
  ): Promise<boolean> {
    console.log(
      `Marking reminder "${reminder.title}" in ${file.path} as complete locally.`,
    );
    try {
      const fileContent = await this.app.vault.read(file);
      const lines = fileContent.split("\n");

      if (reminder.rowNumber >= lines.length || reminder.rowNumber < 0) {
        console.error(
          `Cannot mark reminder complete: Line number ${reminder.rowNumber} out of bounds for ${file.path}.`,
        );
        return false;
      }

      let originalLine = lines[reminder.rowNumber];
      if (originalLine === undefined) {
        console.error(
          `Cannot mark reminder complete: Line ${reminder.rowNumber} content is undefined in ${file.path}.`,
        );
        return false;
      }

      const checkboxRegex = /^(\s*[-*]|[0-9]+\.)\s*\[ \]/;
      if (checkboxRegex.test(originalLine)) {
        const modifiedLine = originalLine.replace(checkboxRegex, "$1 [x]");
        lines[reminder.rowNumber] = modifiedLine;
        reminder.done = true;

        const currentChecksum = generateReminderChecksum(reminder);
        const existingMetadata = extractGoogleTaskMetadata(originalLine);

        if (existingMetadata) {
          const newMetadata: GoogleTaskMetadata = {
            id: existingMetadata.id,
            checksum: currentChecksum,
          };
          // Update comment on the already modified line
          lines[reminder.rowNumber] = this.updateMarkdownLineWithMetadata(
            modifiedLine,
            newMetadata,
          );
        } else {
          console.warn(
            `Could not find Google Task metadata comment for completed reminder "${reminder.title}". Checksum not updated in comment.`,
          );
        }

        await this.app.vault.modify(file, lines.join("\n"));
        console.log(
          `Successfully marked reminder "${reminder.title}" as complete in ${file.path}.`,
        );
        return true;
      } else {
        console.warn(
          `Reminder line "${reminder.title}" in ${file.path} did not match expected checkbox format for completion.`,
        );
        return true;
      }
    } catch (error) {
      console.error(
        `Error marking reminder "${reminder.title}" as complete in ${file.path}:`,
        error,
      );
      return false;
    }
  }

  /**
   * Creates a Google Task and updates the corresponding markdown comment.
   */
  private async handleCreateGoogleTask(
    reminder: Reminder,
    file: TFile,
    targetListId: string,
  ): Promise<{
    status: "created" | "error";
    newMetadata?: GoogleTaskMetadata | null;
  }> {
    console.log(`Creating new task: ${reminder.title}`);
    try {
      const taskInput = convertObsidianToGoogleTask(reminder);
      const currentChecksum = generateReminderChecksum(reminder);
      const createdTask: Task = await this._googleTasksService.createTask(
        targetListId,
        taskInput,
      );
      const newMetadata = { id: createdTask.id, checksum: currentChecksum };
      await this.updateReminderCommentInFile(reminder, file, newMetadata);
      return { status: "created", newMetadata: newMetadata };
    } catch (createError) {
      console.error(`Failed to create task "${reminder.title}":`, createError);
      return { status: "error" };
    }
  }

  /**
   * Recreates a Google Task and updates the corresponding markdown comment.
   * Assumes the task needs recreation (e.g., due to 404 or finding it deleted).
   * @returns An object indicating the outcome: { status: 'recreated' | 'error', newMetadata?: GoogleTaskMetadata | null }
   */
  private async recreateGoogleTaskAndUpdateComment(
    reminder: Reminder,
    file: TFile,
    targetListId: string,
    taskInput: TaskInput,
    currentChecksum: string, // Pass checksum to avoid recalculating
  ): Promise<{
    status: "recreated" | "error";
    newMetadata?: GoogleTaskMetadata | null;
  }> {
    try {
      // 1. Attempt to remove the old comment (best effort)
      await this.updateReminderCommentInFile(reminder, file, null);

      // 2. Create the task anew
      console.log(`Recreating task: ${reminder.title}`);
      const createdTask: Task = await this._googleTasksService.createTask(
        targetListId,
        taskInput,
      );
      const newMetadata = { id: createdTask.id, checksum: currentChecksum }; // Use passed checksum

      // 3. Attempt to add the new comment
      const addedNewComment = await this.updateReminderCommentInFile(
        reminder,
        file,
        newMetadata,
      );
      if (addedNewComment) {
        console.log(
          `Successfully recreated task "${reminder.title}" with new ID ${newMetadata.id} and updated markdown comment.`,
        );
        return { status: "recreated", newMetadata: newMetadata };
      } else {
        console.error(
          `Recreated task "${reminder.title}" (ID: ${newMetadata.id}) but FAILED to update markdown comment.`,
        );
        return { status: "error" }; // Still an error if we couldn't update the comment
      }
    } catch (recreateError) {
      console.error(
        `Failed to recreate task "${reminder.title}":`,
        recreateError,
      );
      return { status: "error" };
    }
  }

  /**
   * Updates a markdown line to include or replace the gtask metadata comment.
   * If metadata is null, it removes any existing gtask comment.
   * @param originalLine The original markdown line content.
   * @param metadata The metadata (id and checksum) to embed, or null to remove.
   * @returns The updated markdown line.
   */
  private updateMarkdownLineWithMetadata(
    originalLine: string,
    metadata: GoogleTaskMetadata | null,
  ): string {
    // Remove existing gtask comment if present
    const lineWithoutComment = originalLine
      .replace(/<!--\s*gtask:.*?\s*-->/g, "")
      .trimEnd();

    // If metadata is null, just return the cleaned line
    if (metadata === null) {
      return lineWithoutComment;
    }

    // Otherwise, construct and append the new comment
    const metadataString = JSON.stringify(metadata);
    const newComment = ` <!-- gtask:${metadataString} -->`;

    return lineWithoutComment + newComment;
  }

  /**
   * Updates the markdown file to add/update/remove the gtask metadata comment for a specific reminder line.
   * Reads the file, modifies the specific line, and writes the changes back.
   * @param reminder The reminder whose line needs updating.
   * @param file The TFile object to modify.
   * @param metadata The metadata to write, or null to remove the comment.
   * @returns True if the file was successfully modified, false otherwise.
   */
  private async updateReminderCommentInFile(
    reminder: Reminder,
    file: TFile,
    metadata: GoogleTaskMetadata | null,
  ): Promise<boolean> {
    try {
      const currentFileContent = await this.app.vault.read(file);
      const currentLines = currentFileContent.split("\n");

      if (reminder.rowNumber >= currentLines.length || reminder.rowNumber < 0) {
        console.error(
          `Failed to update comment for "${reminder.title}": Line number ${reminder.rowNumber} out of bounds in ${file.path}.`,
        );
        return false;
      }

      const originalLine = currentLines[reminder.rowNumber];
      if (originalLine === undefined) {
        console.error(
          `Failed to update comment for "${reminder.title}": Line ${reminder.rowNumber} content is undefined in ${file.path}.`,
        );
        return false;
      }

      const updatedLine = this.updateMarkdownLineWithMetadata(
        originalLine,
        metadata,
      );

      if (updatedLine !== originalLine) {
        currentLines[reminder.rowNumber] = updatedLine;
        await this.app.vault.modify(file, currentLines.join("\n"));
        console.log(
          `Updated markdown comment for task: "${reminder.title}" in ${file.path}`,
        );
        return true;
      } else {
        // No change needed (e.g., trying to remove a comment that wasn't there)
        console.log(
          `No markdown comment update needed for task: "${reminder.title}" in ${file.path}`,
        );
        return true; // Considered successful as the state is correct
      }
    } catch (error) {
      console.error(
        `Error updating markdown comment for task "${reminder.title}" in ${file.path}:`,
        error,
      );
      return false;
    }
  }

  /**
   * Reads the markdown file associated with a reminder and returns the specific line content and the TFile object.
   * @param reminder The reminder object.
   * @returns An object containing the line content and the TFile, or null if an error occurs.
   */
  private async getReminderMarkdownLine(
    reminder: Reminder,
  ): Promise<{ lineContent: string; file: TFile } | null> {
    if (!reminder.file) {
      console.warn(
        "Cannot get line for reminder with no file path:",
        reminder.title,
      );
      return null;
    }

    const file = this.app.vault.getAbstractFileByPath(reminder.file);
    if (!(file instanceof TFile)) {
      console.warn(
        `File not found or not a TFile for reminder: ${reminder.title} in ${reminder.file}`,
      );
      return null;
    }

    try {
      const fileContent = await this.app.vault.read(file);
      const lines = fileContent.split("\n");

      if (reminder.rowNumber >= lines.length || reminder.rowNumber < 0) {
        console.warn(
          `Line number ${reminder.rowNumber} out of bounds for file ${reminder.file} (Total lines: ${lines.length})`,
        );
        return null;
      }

      const lineContent = lines[reminder.rowNumber];
      if (lineContent === undefined) {
        console.warn(
          `Could not read line ${reminder.rowNumber} content from file ${reminder.file}`,
        );
        return null;
      }
      return { lineContent: lineContent, file: file };
    } catch (error) {
      console.error(
        `Error reading file ${reminder.file} for reminder line:`,
        error,
      );
      return null;
    }
  }

  public async syncGoogleTasks(): Promise<void> {
    if (!this.settings.enableGoogleTasks.value) return;
    if (!this._googleTasksService.isAuthenticated()) return;

    console.log("Starting Google Tasks synchronization (v2)...");
    new Notice("Starting Google Tasks sync...");

    let createdCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;
    let completedLocallyCount = 0;
    let errorCount = 0;

    try {
      // 1. Get target task list ID
      const listName = this.settings.googleTasksListName.value;
      const taskList =
        await this._googleTasksService.getTaskListByName(listName);
      // TODO: Handle case where taskList is not found (maybe create it, requires _googleTasksService.createTaskList)
      if (!taskList) {
        console.error(`Target Google Tasks list "${listName}" not found.`);
        new Notice(
          `Google Tasks Sync Error: List "${listName}" not found.`,
          5000,
        );
        return;
      }
      const targetListId = taskList.id;

      // 2. Fetch *active* tasks from Google Tasks
      console.log(`Fetching active tasks from Google list "${listName}"...`);
      const googleTasks = await this._googleTasksService.getTasks(
        targetListId,
        { showCompleted: false, showHidden: false },
      );
      const activeGoogleTasksMap = new Map<string, Task>();
      googleTasks.forEach((task) => activeGoogleTasksMap.set(task.id, task));
      console.log(`Found ${activeGoogleTasksMap.size} active tasks in Google.`);

      // 3. Get all Obsidian reminders
      const obsidianReminders = this._reminders.reminders;
      console.log(
        `Found ${obsidianReminders.length} Obsidian reminders to process.`,
      );

      // 4. Iterate through Obsidian reminders and reconcile
      for (const reminder of obsidianReminders) {
        try {
          const lineData = await this.getReminderMarkdownLine(reminder);
          if (lineData === null) {
            skippedCount++;
            continue;
          }
          const { lineContent, file } = lineData;
          const existingMetadata = extractGoogleTaskMetadata(lineContent);
          const currentChecksum = generateReminderChecksum(reminder);
          const taskInput = convertObsidianToGoogleTask(reminder);

          let resultStatus:
            | "created"
            | "updated"
            | "recreated"
            | "skipped"
            | "completedLocally"
            | "error" = "error";

          if (existingMetadata) {
            const syncResult = await this.handleExistingTaskSync(
              reminder,
              file,
              existingMetadata,
              currentChecksum,
              targetListId,
              taskInput,
              activeGoogleTasksMap,
            );
            resultStatus = syncResult.status;
          } else {
            const createResult = await this.handleCreateGoogleTask(
              reminder,
              file,
              targetListId,
            );
            resultStatus = createResult.status;
          }

          switch (resultStatus) {
            case "created":
              createdCount++;
              break;
            case "updated":
              updatedCount++;
              break;
            case "recreated":
              createdCount++;
              break;
            case "skipped":
              skippedCount++;
              break;
            case "completedLocally":
              completedLocallyCount++;
              break;
            case "error":
            default:
              errorCount++;
              break;
          }
        } catch (loopError) {
          console.error(
            `Unexpected error processing reminder "${reminder.title}" in file ${reminder.file}:`,
            loopError,
          );
          errorCount++;
        }
      } // End reminder loop

      // TODO: (Future Task) Handle tasks in Google that are NOT in Obsidian (e.g., delete them from Google?)

      console.log("Google Tasks synchronization finished.");
      new Notice(
        `Google Tasks Sync Complete: ${createdCount} created/recreated, ${updatedCount} updated, ${completedLocallyCount} completed locally, ${skippedCount} skipped, ${errorCount} errors.`,
        7000,
      );
    } catch (error) {
      console.error("Error during Google Tasks synchronization setup:", error);
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      new Notice(`Google Tasks Sync Failed: ${errorMessage}`, 5000);
    }
  }
}
