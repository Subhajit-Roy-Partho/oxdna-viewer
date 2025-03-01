/// <reference path="../typescript_definitions/oxView.d.ts" />
/// <reference path="../typescript_definitions/index.d.ts" />

import Dexie from "https://cdn.skypack.dev/dexie";
import { deflate, inflate } from "https://cdn.skypack.dev/pako";

interface EntryType {
  id?: number;
  structure: { data: ArrayBuffer; commitName: string }[];
  structureName: string;
  date: number;
}

const db = new Dexie("Structures");
db.version(1).stores({
  structureData: "++id, name", // auto-increment primary key
});

// Helper to get our table with proper type information.
const structureData = db.table<EntryType>("structureData");

export function createCompressedOxViewFile(
  space?: string | number,
): Uint8Array {
  // Prepare your data object
  const data = {
    date: new Date(),
    box: box.toArray(),
    systems,
    forces: forceHandler.forces,
    selections: selectionListHandler.serialize(),
  };

  const jsonString = JSON.stringify(data, null, space);
  return deflate(jsonString, { level: 9 });
}

export async function saveStructure(): Promise<void> {
  try {
    const commitNameElement = document.getElementById(
      "commitName",
    ) as HTMLInputElement;

    if (!commitNameElement || commitNameElement.value === "") {
      alert("No commit name given");
      return;
    }
    const compressedData = createCompressedOxViewFile();
    const queryString = window.location.search;
    const urlParams = new URLSearchParams(queryString);

    if (urlParams.has("structureId")) {
      const id = parseInt(urlParams.get("structureId") as string, 10);
      if (!isNaN(id)) {
        const old = await structureData.get(id);
        if (old) {
          const newDataArr: { data: ArrayBuffer; commitName: string }[] = [
            ...old.structure,
            { data: compressedData, commitName: commitNameElement.value },
          ];

          await structureData.put({
            id,
            structure: newDataArr,
            date: old.date,
            structureName: old.structureName,
          });
        } else {
          console.error("Invalid structure id parameter.");
        }
      } else {
        console.log("ID parameter not found.");
      }
    }
  } catch (error) {
    console.error("Error saving structure:", error);
  }
}

export async function loadStructure(): Promise<void> {
  try {
    const queryString = window.location.search;
    const urlParams = new URLSearchParams(queryString);

    if (urlParams.has("structureId")) {
      if (urlParams.has("commit")) {
        const id = parseInt(urlParams.get("structureId") as string, 10);
        if (!isNaN(id)) {
          const storedData = await structureData.get(id);
          if (!storedData) {
            console.error(`No structure found with id ${id}.`);
            return;
          }

          const data = storedData.structure;
          if (data.length === 0) {
            console.error("No compressed data available in this structure.");
            return;
          }
          const compData = new Uint8Array(
            data.find((i) => i.commitName === urlParams.get("commit")).data,
          );
          const uncompressed = inflate(compData, { to: "string" });
          const file = new File([uncompressed], "output.oxview", {
            type: "text/plain",
          });
          handleFiles([file]);
        } else {
          console.error("Invalid structure id parameter.");
        }
      } else {
        const id = parseInt(urlParams.get("structureId") as string, 10);
        if (!isNaN(id)) {
          const storedData = await structureData.get(id);
          if (!storedData) {
            console.error(`No structure found with id ${id}.`);
            return;
          }

          const data = storedData.structure;
          if (data.length === 0) {
            console.error("No compressed data available in this structure.");
            return;
          }
          const compData = new Uint8Array(data[data.length - 1].data);
          const uncompressed = inflate(compData, { to: "string" });
          const file = new File([uncompressed], "output.oxview", {
            type: "text/plain",
          });
          handleFiles([file]);
        } else {
          console.error("Invalid structure id parameter.");
        }
      }
    } else {
      console.log("ID parameter not found.");
    }
  } catch (error) {
    console.error("Error loading structure:", error);
  }
}

const queryString = window.location.search;
const urlParams = new URLSearchParams(queryString);
if (urlParams.has("load")) {
  const shouldLoad = urlParams.get("load") === "true";

  if (shouldLoad) {
    loadStructure();
  }
}

async function viewHistory() {
  // Get the structureId query parameter from the URL
  const params = new URLSearchParams(window.location.search);
  const structureIdParam = params.get("structureId");

  if (!structureIdParam) {
    console.error("No structureId query parameter found in the URL.");
    return;
  }

  // Convert the parameter to a number (assuming your ids are numeric)
  const structureId = parseInt(structureIdParam, 10);

  try {
    // Retrieve the entry from the Dexie database by its id
    const entry = await structureData.get(structureId);

    if (!entry) {
      console.error(`No entry found for structureId: ${structureId}`);
      return;
    }

    // Find the div where the links will be inserted
    const commitListDiv = document.getElementById("commitList");
    if (!commitListDiv) {
      console.error("Div with id 'commitList' not found.");
      return;
    }

    // Clear any existing content in the div
    commitListDiv.innerHTML = "";

    // Loop through each commit in the entry's structure array and create an <a> element
    entry.structure.forEach((commit) => {
      const link = document.createElement("a");
      // Here you can set the href as needed; currently it is set to '#' as a placeholder.
      link.href = `/?structureId=${structureId}&load=true&commit=${commit.commitName}`;
      link.textContent = commit.commitName;

      // Optionally, wrap each link in a div or add a line break for formatting
      const lineBreak = document.createElement("br");

      // Append the link and line break to the target div
      commitListDiv.appendChild(link);
      commitListDiv.appendChild(lineBreak);
    });
  } catch (error) {
    console.error("Error retrieving data from Dexie DB:", error);
  }
}

(window as any).saveStructure = saveStructure;
(window as any).loadStructure = loadStructure;
(window as any).viewHistory = viewHistory;
