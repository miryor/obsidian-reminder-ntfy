import type ReminderPlugin from "main";
import { MarkdownView } from "obsidian";
import { scanReminders } from "./scan-reminders";
import { showReminderList } from "./show-reminder-list";
import { convertReminderTimeFormat } from "./convert-reminder-time-format";
import { showDateChooser } from "./show-date-chooser";
import { toggleChecklistStatus } from "./toggle-checklist-status";
import { refreshGoogleTasksToken } from "./refresh-google-tasks-token";
import { getGoogleTasks } from "./get-google-tasks";

export function registerCommands(plugin: ReminderPlugin) {
  plugin.addCommand({
    id: "scan-reminders",
    name: "Scan reminders",
    checkCallback: (checking: boolean) => {
      return scanReminders(checking, plugin);
    },
  });

  plugin.addCommand({
    id: "show-reminders",
    name: "Show reminders",
    checkCallback: (checking: boolean) => {
      return showReminderList(checking, plugin.ui);
    },
  });

  plugin.addCommand({
    id: "convert-reminder-time-format",
    name: "Convert reminder time format",
    checkCallback: (checking: boolean) => {
      return convertReminderTimeFormat(checking, plugin);
    },
  });

  plugin.addCommand({
    id: "show-date-chooser",
    name: "Show calendar popup",
    icon: "calendar-with-checkmark",
    hotkeys: [
      {
        modifiers: ["Meta", "Shift"],
        key: "2", // Shift + 2 = `@`
      },
    ],
    editorCheckCallback: (checking, editor): boolean | void => {
      return showDateChooser(checking, editor, plugin.ui);
    },
  });

  plugin.addCommand({
    id: "toggle-checklist-status",
    name: "Toggle checklist status",
    hotkeys: [
      {
        modifiers: ["Meta", "Shift"],
        key: "Enter",
      },
    ],
    editorCheckCallback: (checking, editor, view): boolean | void => {
      if (view instanceof MarkdownView) {
        return toggleChecklistStatus(checking, view, plugin);
      } else {
        return false;
      }
    },
  });

  // Add command to clear Google Tasks authentication
  plugin.addCommand({
    id: "clear-google-tasks-auth",
    name: "Clear Google Tasks authentication",
    callback: () => {
      plugin.clearGoogleTasksAuth();
    },
  });

  // Add command to force re-authentication
  plugin.addCommand({
    id: "force-reauthenticate-google-tasks",
    name: "Force Re-authenticate with Google Tasks",
    callback: () => {
      console.log("Forcing Google Tasks re-authentication...");
      // Clear existing tokens first
      plugin.clearGoogleTasksAuth();
      // Short delay to allow notice from clear to show briefly?
      // setTimeout(() => {
      //   plugin.authenticateWithGoogleTasks();
      // }, 500);
      // No, run immediately
      plugin.authenticateWithGoogleTasks();
    },
  });

  // Add command to verify Google Tasks authentication
  plugin.addCommand({
    id: "verify-google-tasks-auth",
    name: "Verify Google Tasks authentication",
    callback: () => {
      plugin.verifyGoogleTasksAuth();
    },
  });

  // Add command to get Google Tasks list
  plugin.addCommand({
    id: "get-google-tasks-list",
    name: "Get Google Tasks list",
    callback: () => {
      plugin.getGoogleTasksList();
    },
  });

  // Add command to get tasks from Google Tasks list
  plugin.addCommand({
    id: "get-google-tasks",
    name: "Get tasks from Google Tasks list (Log to console)",
    checkCallback: (checking: boolean) => {
      return getGoogleTasks(checking, plugin);
    },
  });

  // Add command to manually trigger Google Tasks sync
  plugin.addCommand({
    id: "sync-google-tasks",
    name: "Sync reminders with Google Tasks",
    checkCallback: (checking: boolean) => {
      if (checking) {
        return plugin.settings.enableGoogleTasks.value;
      }
      plugin.syncGoogleTasks(); // Call the new sync method
      return true;
    },
  });

  // Add command to refresh Google Tasks token
  plugin.addCommand({
    id: "refresh-google-tasks-token",
    name: "Refresh Google Tasks token",
    checkCallback: (checking: boolean) => {
      return refreshGoogleTasksToken(checking, plugin);
    },
  });
}
