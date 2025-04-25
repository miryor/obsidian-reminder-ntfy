import type ReminderPlugin from "main";
import { MarkdownView } from "obsidian";
import { scanReminders } from "./scan-reminders";
import { showReminderList } from "./show-reminder-list";
import { convertReminderTimeFormat } from "./convert-reminder-time-format";
import { showDateChooser } from "./show-date-chooser";
import { toggleChecklistStatus } from "./toggle-checklist-status";

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
}
