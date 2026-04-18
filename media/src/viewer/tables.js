import { clamp } from "./syntaxHighlighting.js";

const TABLE_COLUMN_MAX_WIDTH = 360;
const TABLE_COLUMN_GROWTH_LIMIT = 720;
const SORT_COLLATOR = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

export async function enhanceTables(container, tools) {
  const tables = container.querySelectorAll("table");

  for (const table of tables) {
    if (
      table.dataset.enhanced === "true" ||
      table.closest(".front-matter-card")
    ) {
      continue;
    }

    table.dataset.enhanced = "true";
    const model = extractTableModel(table);
    if (!model) {
      continue;
    }

    const block = document.createElement("section");
    block.className = "table-block";

    const actions = document.createElement("div");
    actions.className = "table-inline-actions";

    const openButton = document.createElement("button");
    openButton.type = "button";
    openButton.className = "table-open-button icon-button icon-table-tools";
    openButton.title = "Open table tools";
    openButton.setAttribute("aria-label", "Open table tools");
    openButton.addEventListener("click", () => {
      const modalParts = createTableModalContent(model);
      tools.showModal({
        title: model.caption || "Table tools",
        content: modalParts.content,
        headerContent: modalParts.header,
        wide: true,
      });
    });

    const frame = document.createElement("div");
    frame.className = "table-scroll-frame";

    table.replaceWith(block);
    actions.append(openButton);
    frame.append(table);
    block.append(actions, frame);
  }
}

function createTableModalContent(model) {
  const stage = document.createElement("section");
  stage.className = "table-modal-stage";

  const header = document.createElement("div");
  header.className = "table-modal-header";

  const toolbar = document.createElement("div");
  toolbar.className = "table-modal-toolbar";

  const actions = document.createElement("div");
  actions.className = "table-modal-actions";

  const filterInput = document.createElement("input");
  filterInput.type = "search";
  filterInput.className = "table-filter-input";
  filterInput.placeholder = "Filter rows";
  filterInput.autocomplete = "off";
  filterInput.spellcheck = false;

  const summary = document.createElement("p");
  summary.className = "table-modal-summary";

  const toggles = document.createElement("div");
  toggles.className = "table-column-toggles";

  const tableFrame = document.createElement("div");
  tableFrame.className = "table-modal-frame";

  const state = {
    query: "",
    sortColumn: -1,
    sortDirection: "asc",
    visibleColumns: new Set(model.headers.map((_, index) => index)),
    columnFloorWidths: new Map(
      model.headers.map((header, index) => [
        index,
        getColumnFloorWidth(model, index, header),
      ]),
    ),
    columnWidths: new Map(
      model.headers.map((header, index) => [
        index,
        getInitialColumnWidth(model, index, header),
      ]),
    ),
  };

  filterInput.addEventListener("input", () => {
    state.query = filterInput.value.trim().toLowerCase();
    render();
  });

  const showAllButton = createTableActionButton("Show all", () => {
    state.visibleColumns = new Set(model.headers.map((_, index) => index));
    render();
  });

  const hideAllButton = createTableActionButton("Hide all", () => {
    state.visibleColumns = new Set();
    state.sortColumn = -1;
    render();
  });

  const fitColumnsButton = createTableActionButton("Fit columns", () => {
    fitColumnsToFrame(model, state, tableFrame);
    render();
  });

  model.headers.forEach((headerText, index) => {
    const label = document.createElement("label");
    label.className = "table-column-toggle";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = true;
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) {
        state.visibleColumns.add(index);
      } else {
        state.visibleColumns.delete(index);
      }

      if (!state.visibleColumns.has(state.sortColumn)) {
        state.sortColumn = -1;
      }
      render();
    });

    const text = document.createElement("span");
    text.textContent = headerText;
    label.append(checkbox, text);
    toggles.append(label);
  });

  actions.append(showAllButton, hideAllButton, fitColumnsButton);
  toolbar.append(filterInput, summary, actions);
  header.append(toolbar, toggles);
  stage.append(tableFrame);

  render();
  return {
    content: stage,
    header,
  };

  function render() {
    const visibleColumns = model.headers
      .map((headerText, index) => ({ header: headerText, index }))
      .filter(({ index }) => state.visibleColumns.has(index));

    let rows = model.rows.filter((row) => {
      if (!state.query) {
        return true;
      }
      return row.some((value) => value.toLowerCase().includes(state.query));
    });

    if (state.sortColumn >= 0) {
      rows = [...rows].sort((left, right) => {
        const comparison = SORT_COLLATOR.compare(
          left[state.sortColumn] ?? "",
          right[state.sortColumn] ?? "",
        );
        return state.sortDirection === "asc" ? comparison : -comparison;
      });
    }

    summary.textContent = `${rows.length} of ${model.rows.length} rows visible • ${visibleColumns.length} of ${model.headers.length} columns shown`;

    toggles
      .querySelectorAll("input[type='checkbox']")
      .forEach((input, index) => {
        if (input instanceof HTMLInputElement) {
          input.checked = state.visibleColumns.has(index);
        }
      });

    if (state.visibleColumns.size === 0) {
      const empty = document.createElement("div");
      empty.className = "table-empty-state";
      empty.textContent =
        "All columns are hidden. Use Show all or enable columns above.";
      tableFrame.replaceChildren(empty);
      return;
    }

    if (rows.length === 0) {
      const empty = document.createElement("div");
      empty.className = "table-empty-state";
      empty.textContent = "No rows match the current filter.";
      tableFrame.replaceChildren(empty);
      return;
    }

    const table = document.createElement("table");
    table.className = "table-modal-table";

    const colgroup = document.createElement("colgroup");
    for (const column of visibleColumns) {
      const col = document.createElement("col");
      const width =
        state.columnWidths.get(column.index) ?? TABLE_COLUMN_MAX_WIDTH;
      col.style.width = `${width}px`;
      col.style.minWidth = `${state.columnFloorWidths.get(column.index) ?? 140}px`;
      colgroup.append(col);
    }

    const thead = document.createElement("thead");
    const headRow = document.createElement("tr");

    for (const column of visibleColumns) {
      const th = document.createElement("th");
      const headInner = document.createElement("div");
      headInner.className = "table-th-inner";

      const button = document.createElement("button");
      button.type = "button";
      button.className = "table-sort-button";
      button.textContent = column.header;
      if (state.sortColumn === column.index) {
        button.dataset.direction = state.sortDirection;
      }
      button.addEventListener("click", () => {
        if (state.sortColumn !== column.index) {
          state.sortColumn = column.index;
          state.sortDirection = "asc";
        } else if (state.sortDirection === "asc") {
          state.sortDirection = "desc";
        } else {
          state.sortColumn = -1;
          state.sortDirection = "asc";
        }
        render();
      });

      const resizeHandle = document.createElement("button");
      resizeHandle.type = "button";
      resizeHandle.className = "table-resize-handle";
      resizeHandle.title = `Resize ${column.header} column`;
      resizeHandle.setAttribute("aria-label", `Resize ${column.header} column`);
      resizeHandle.addEventListener("pointerdown", (event) => {
        beginColumnResize(event, column.index, state, render);
      });

      headInner.append(button, resizeHandle);
      th.append(headInner);
      headRow.append(th);
    }

    thead.append(headRow);

    const tbody = document.createElement("tbody");
    for (const row of rows) {
      const tr = document.createElement("tr");
      for (const column of visibleColumns) {
        const td = document.createElement("td");
        td.textContent = row[column.index] ?? "";
        tr.append(td);
      }
      tbody.append(tr);
    }

    table.append(colgroup, thead, tbody);
    tableFrame.replaceChildren(table);
  }
}

function beginColumnResize(event, columnIndex, state, rerender) {
  event.preventDefault();
  event.stopPropagation();

  const pointerId = event.pointerId;
  const startX = event.clientX;
  const startWidth =
    state.columnWidths.get(columnIndex) ?? TABLE_COLUMN_MAX_WIDTH;
  const minWidth = state.columnFloorWidths.get(columnIndex) ?? 140;
  const handle = event.currentTarget;
  if (handle instanceof HTMLElement) {
    handle.setPointerCapture?.(pointerId);
    handle.classList.add("is-active");
  }

  const onPointerMove = (moveEvent) => {
    const nextWidth = clamp(
      startWidth + moveEvent.clientX - startX,
      minWidth,
      TABLE_COLUMN_GROWTH_LIMIT,
    );
    state.columnWidths.set(columnIndex, nextWidth);
    rerender();
  };

  const finishResize = () => {
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", finishResize);
    window.removeEventListener("pointercancel", finishResize);
    if (handle instanceof HTMLElement) {
      handle.classList.remove("is-active");
      handle.releasePointerCapture?.(pointerId);
    }
  };

  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", finishResize, { once: true });
  window.addEventListener("pointercancel", finishResize, { once: true });
}

function extractTableModel(table) {
  const allRows = Array.from(table.querySelectorAll("tr"));
  if (allRows.length === 0) {
    return undefined;
  }

  const headerRow = table.tHead?.rows[0] ?? allRows[0];
  const headers = Array.from(headerRow.cells).map((cell, index) => {
    const text = normalizeTableCellText(cell.textContent);
    return text || `Column ${index + 1}`;
  });

  const bodyRows = Array.from(table.tBodies).flatMap((section) =>
    Array.from(section.rows),
  );
  const sourceRows = bodyRows.length > 0 ? bodyRows : allRows.slice(1);
  const rows = sourceRows.map((row) =>
    Array.from(row.cells).map((cell) =>
      normalizeTableCellText(cell.textContent),
    ),
  );
  const columnCount = Math.max(
    headers.length,
    ...rows.map((row) => row.length),
  );

  while (headers.length < columnCount) {
    headers.push(`Column ${headers.length + 1}`);
  }

  rows.forEach((row) => {
    while (row.length < columnCount) {
      row.push("");
    }
  });

  return {
    caption:
      normalizeTableCellText(table.querySelector("caption")?.textContent) ||
      "Table tools",
    headers,
    rows,
  };
}

function normalizeTableCellText(value) {
  return (value || "").replace(/\s+/g, " ").trim();
}

function createTableActionButton(label, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "table-action-button";
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
}

function fitColumnsToFrame(model, state, tableFrame) {
  const visibleColumns = model.headers
    .map((headerText, index) => ({ header: headerText, index }))
    .filter(({ index }) => state.visibleColumns.has(index));

  if (visibleColumns.length === 0) {
    return;
  }

  const availableWidth = Math.max(tableFrame.clientWidth - 24, 0);
  const currentWidths = visibleColumns.map(
    ({ index }) => state.columnWidths.get(index) ?? TABLE_COLUMN_MAX_WIDTH,
  );
  const floorWidths = visibleColumns.map(
    ({ index, header }) =>
      state.columnFloorWidths.get(index) ??
      getColumnFloorWidth(model, index, header),
  );
  const totalWidth = currentWidths.reduce((sum, width) => sum + width, 0);

  if (availableWidth <= 0 || totalWidth <= availableWidth) {
    return;
  }

  let overflow = totalWidth - availableWidth;
  const nextWidths = [...currentWidths];

  while (overflow > 1) {
    const shrinkable = nextWidths
      .map((width, index) => ({
        index,
        capacity: width - floorWidths[index],
      }))
      .filter(({ capacity }) => capacity > 0)
      .sort((left, right) => right.capacity - left.capacity);

    if (shrinkable.length === 0) {
      break;
    }

    for (const column of shrinkable) {
      if (overflow <= 1) {
        break;
      }

      const reduction = Math.min(
        Math.max(Math.ceil(overflow / shrinkable.length), 1),
        column.capacity,
      );
      nextWidths[column.index] -= reduction;
      overflow -= reduction;
    }
  }

  visibleColumns.forEach(({ index }, visibleIndex) => {
    state.columnWidths.set(index, nextWidths[visibleIndex]);
  });
}

function getColumnFloorWidth(model, columnIndex, header) {
  const samples = [header, ...model.rows.map((row) => row[columnIndex] ?? "")];
  const longest = samples.reduce(
    (max, sample) => Math.max(max, normalizeTableCellText(sample).length),
    0,
  );
  return clamp(longest * 7.4 + 56, 140, TABLE_COLUMN_MAX_WIDTH);
}

function getInitialColumnWidth(model, columnIndex, header) {
  const samples = [
    header,
    ...model.rows.slice(0, 24).map((row) => row[columnIndex] ?? ""),
  ];
  const longest = samples.reduce(
    (max, sample) => Math.max(max, normalizeTableCellText(sample).length),
    0,
  );
  return clamp(longest * 8.2 + 48, 160, TABLE_COLUMN_MAX_WIDTH);
}
