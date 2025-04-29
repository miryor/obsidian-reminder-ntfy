import type { Reminder } from "model/reminder";
import type { TaskInput } from "./google-tasks"; // Assuming TaskInput is exported from google-tasks.ts

/**
 * Metadata stored within the Obsidian reminder line comment.
 */
export interface GoogleTaskMetadata {
  id: string;
  checksum: string;
}

// Placeholder for the checksum function
function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0; // Convert to 32bit integer
  }
  return hash.toString(16); // Return as hex string
}

/**
 * Converts an Obsidian Reminder object into the format needed for Google Tasks API input.
 * @param reminder The Obsidian Reminder object.
 * @returns A TaskInput object for Google Tasks API.
 */
export function convertObsidianToGoogleTask(reminder: Reminder): TaskInput {
  const taskInput: TaskInput = {
    title: reminder.title.trim(), // Ensure title has no leading/trailing whitespace
  };

  // Set due date if present
  if (reminder.time) {
    // Google Tasks API expects RFC3339 timestamp (e.g., 2023-10-27T10:00:00.000Z)
    // If the reminder has only a date (no time component), we should format accordingly
    // Assuming reminder.time.moment() is available and valid
    try {
      // Use the hasTimePart property to check if time is included
      const hasTime = reminder.time.hasTimePart;
      if (hasTime) {
        taskInput.due = reminder.time.moment().toISOString(); // Full timestamp
      } else {
        // Format as YYYY-MM-DD if it's a date-only reminder
        taskInput.due =
          reminder.time.moment().format("YYYY-MM-DD") + "T00:00:00.000Z";
        // Google Tasks seems to handle date-only better when a zeroed time is included
      }
    } catch (e) {
      console.error(
        "Error formatting reminder time for Google Task:",
        e,
        reminder.time,
      );
      // Decide how to handle invalid dates - perhaps omit the due date?
    }
  }

  // Set notes with a link back to the Obsidian note
  if (reminder.file) {
    // Constructing a basic obsidian URI. This might need refinement based on vault name/paths.
    const obsidianLink = `Obsidian Reminder: obsidian://open?path=${encodeURIComponent(reminder.file)}&line=${reminder.rowNumber}`;
    taskInput.notes = obsidianLink;
  }

  // Set status and completed timestamp
  if (reminder.done) {
    taskInput.status = "completed";
    // Google Tasks API documentation indicates 'completed' timestamp is read-only on creation/update
    // but it's good practice to set it conceptually if marking as done via update
    // taskInput.completed = new Date().toISOString(); // Set this if updating status to completed
  } else {
    taskInput.status = "needsAction";
  }

  return taskInput;
}

/**
 * Generates a checksum based on the relevant fields of a Reminder object.
 * This helps detect if the reminder has changed since the last sync.
 * @param reminder The Obsidian Reminder object.
 * @returns A checksum string.
 */
export function generateReminderChecksum(reminder: Reminder): string {
  // Create a canonical string representation of the reminder fields relevant to sync
  const parts: (string | number | boolean | undefined | null)[] = [
    reminder.title.trim(),
    reminder.time ? reminder.time.moment().toISOString() : null, // Consistent ISO format or null
    reminder.done, // Boolean status
    // Add other fields here if they become part of the sync in the future
    // e.g., reminder.notes (if syncing notes content beyond the link)
  ];

  // Join parts with a delimiter that's unlikely to appear in the data itself
  const canonicalString = parts.map((part) => String(part)).join("|~|");

  // Generate the hash
  return simpleHash(canonicalString);
}

/**
 * Extracts Google Task ID and checksum from the HTML comment in a reminder line.
 * The expected format is <!-- gtask:{"id":"TASK_ID","checksum":"CHECKSUM"} -->
 * @param reminderLine The full text line of the reminder in Markdown.
 * @returns An object with id and checksum, or null if not found or invalid.
 */
export function extractGoogleTaskMetadata(
  reminderLine: string,
): GoogleTaskMetadata | null {
  const match = reminderLine.match(/<!--\s*gtask:(.*?)\s*-->/);
  if (!match || !match[1]) {
    return null;
  }

  try {
    // Attempt to parse the JSON-like content within the comment
    const metadataString = match[1].trim();
    // Basic validation to ensure it looks like JSON before parsing
    if (!metadataString.startsWith("{") || !metadataString.endsWith("}")) {
      console.warn(
        "Invalid gtask metadata format (not JSON object):",
        metadataString,
      );
      return null;
    }

    // A simple JSON parser is likely sufficient here, but a more robust one could be used.
    // We need to be careful about potential parsing errors if the format is corrupted.
    // Let's use a try-catch with basic validation.
    const parsed = JSON.parse(metadataString);

    // Validate required fields
    if (typeof parsed.id === "string" && typeof parsed.checksum === "string") {
      return {
        id: parsed.id,
        checksum: parsed.checksum,
      };
    } else {
      console.warn("Invalid gtask metadata format (missing fields):", parsed);
      return null;
    }
  } catch (error) {
    console.error(
      "Error parsing gtask metadata from comment:",
      error,
      "Input:",
      match[1],
    );
    return null;
  }
}
