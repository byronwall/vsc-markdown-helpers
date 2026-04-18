import hljs from "highlight.js/lib/common";
import mermaid from "mermaid";
import svgPanZoom from "svg-pan-zoom";
import { hasTextSelectionWithin } from "./shared.js";

const COLLAPSED_CODE_LINES = 15;
const TABLE_COLUMN_MAX_WIDTH = 360;
const TABLE_COLUMN_GROWTH_LIMIT = 720;
const PATH_TOKEN_RE =
  /(^|[\s([{"'`])((?:file:\/\/\/|~\/|\.\.\/|\.\/|\/)?[A-Za-z0-9_@.~-]+(?:\/[A-Za-z0-9_@.,+=~-]+)+(?:\/)?(?:(?::\d+(?::\d+)?(?:-\d+)?)|(?:#L\d+(?:C\d+)?(?:-L?\d+)?)|(?:#\S+))?)(?=$|[\s)\]}"'`.,;!?])/gm;
const SORT_COLLATOR = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});
let localLinkHoverCard;
let localLinkHoverActiveGroup;
let localLinkHoverRequestToken = 0;
let localLinkHoverListenersBound = false;

export async function enhancePreview(container, tools) {
  await Promise.all([
    enhanceLocalLinks(container, tools),
    enhanceTables(container, tools),
    enhanceCodeBlocks(container, tools),
    enhanceMermaidBlocks(container, tools),
  ]);
}

async function enhanceLocalLinks(container, tools) {
  const localAnchors = Array.from(
    container.querySelectorAll("a[data-local-href]"),
  );

  const textNodes = collectLinkableTextNodes(container);
  const hrefs = new Set();
  for (const anchor of localAnchors) {
    const href = anchor.getAttribute("data-local-href");
    if (href) {
      hrefs.add(href);
    }
  }

  for (const node of textNodes) {
    for (const match of getPathTokenMatches(node.textContent || "")) {
      hrefs.add(match.rawValue);
    }
  }

  const resolvedByHref = new Map();
  if (hrefs.size > 0) {
    const resolutions = await tools.requestResolvedLocalLinks([...hrefs]);
    for (const entry of resolutions) {
      if (entry && typeof entry.href === "string") {
        resolvedByHref.set(entry.href, entry);
      }
    }
  }

  for (const anchor of localAnchors) {
    const href = anchor.getAttribute("data-local-href");
    if (href) {
      const resolution = resolvedByHref.get(href);
      if (resolution) {
        applyResolvedLocalLinkMetadata(anchor, resolution);
      }
    }
    activateLocalLink(anchor, tools);
  }

  for (const node of textNodes) {
    replacePathTokensInTextNode(node, tools, resolvedByHref);
  }
}

function collectLinkableTextNodes(container) {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!(node.parentElement instanceof HTMLElement)) {
        return NodeFilter.FILTER_REJECT;
      }

      if (
        node.parentElement.closest(
          "a, pre, script, style, button, input, textarea",
        )
      ) {
        return NodeFilter.FILTER_REJECT;
      }

      if (!node.textContent || !containsPathToken(node.textContent)) {
        return NodeFilter.FILTER_REJECT;
      }

      return NodeFilter.FILTER_ACCEPT;
    },
  });

  const textNodes = [];
  while (walker.nextNode()) {
    textNodes.push(walker.currentNode);
  }

  return textNodes;
}

async function enhanceCodeBlocks(container, tools) {
  const blocks = container.querySelectorAll(
    "pre > code:not(.language-mermaid)",
  );

  for (const code of blocks) {
    const pre = code.parentElement;
    if (!pre || pre.dataset.enhanced === "true") {
      continue;
    }

    pre.dataset.enhanced = "true";
    const language = getLanguageLabel(code);
    const source = code.textContent || "";
    const lineCount = countLines(source);

    applySyntaxHighlighting(code, language);

    const wrapper = document.createElement("div");
    wrapper.className = "code-block-card";
    if (lineCount > COLLAPSED_CODE_LINES) {
      wrapper.classList.add("is-collapsed");
    }

    const toolbar = document.createElement("div");
    toolbar.className = "code-block-toolbar";

    const meta = document.createElement("div");
    meta.className = "code-block-meta";

    const label = document.createElement("span");
    label.className = "code-block-label";
    label.textContent = language || "code";

    const stats = document.createElement("span");
    stats.className = "code-block-stats";
    stats.textContent = `${lineCount} ${lineCount === 1 ? "line" : "lines"}`;
    meta.append(label, stats);

    const actions = document.createElement("div");
    actions.className = "code-block-actions";

    const copyButton = document.createElement("button");
    copyButton.type = "button";
    copyButton.className = "code-block-button icon-button icon-copy";
    copyButton.title = "Copy code block";
    copyButton.setAttribute("aria-label", "Copy code block");
    copyButton.addEventListener("click", async () => {
      await tools.copyText(source);
      flashButton(copyButton, "Copied code block");
    });

    const modalButton = document.createElement("button");
    modalButton.type = "button";
    modalButton.className = "code-block-button icon-button icon-expand";
    modalButton.title = "Show full code sample";
    modalButton.setAttribute("aria-label", "Show full code sample");
    modalButton.addEventListener("click", () => {
      tools.showModal({
        title: language || "Code sample",
        subtitle: `${lineCount} ${lineCount === 1 ? "line" : "lines"}`,
        content: createCodeModalContent(source, language),
        wide: true,
      });
    });

    const openButton = document.createElement("button");
    openButton.type = "button";
    openButton.className = "code-block-button icon-button icon-open-code";
    openButton.title = "Open code block in editor";
    openButton.setAttribute("aria-label", "Open code block in editor");
    openButton.addEventListener("click", () => {
      tools.vscode.postMessage({
        type: "openPreviewCodeBlock",
        language,
        content: source,
      });
    });

    actions.append(copyButton, modalButton, openButton);

    if (lineCount > COLLAPSED_CODE_LINES) {
      const expandButton = document.createElement("button");
      expandButton.type = "button";
      expandButton.className = "code-block-button code-block-expand-button";
      expandButton.textContent = "Expand";
      expandButton.addEventListener("click", () => {
        const collapsed = wrapper.classList.toggle("is-collapsed");
        expandButton.textContent = collapsed ? "Expand" : "Collapse";
      });
      wrapper.append(expandButton);
    }

    const viewport = document.createElement("div");
    viewport.className = "code-block-viewport";

    pre.classList.add("code-block-pre");

    pre.replaceWith(wrapper);
    viewport.append(pre);
    toolbar.append(meta, actions);
    wrapper.append(toolbar, viewport);
  }
}

async function enhanceTables(container, tools) {
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

async function enhanceMermaidBlocks(container, tools) {
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "loose",
    theme: "neutral",
    flowchart: { useMaxWidth: true, htmlLabels: true },
  });

  const blocks = container.querySelectorAll(
    'pre > code.language-mermaid:not([data-mermaid="true"])',
  );

  for (const code of blocks) {
    const pre = code.parentElement;
    if (!pre) {
      continue;
    }

    code.dataset.mermaid = "true";
    const source = code.textContent || "";
    const language = getLanguageLabel(code) || "mermaid";
    const lineCount = countLines(source);
    const wrapper = document.createElement("div");
    wrapper.className = "mermaid-card";

    const toolbar = document.createElement("div");
    toolbar.className = "code-block-toolbar mermaid-toolbar";

    const meta = document.createElement("div");
    meta.className = "code-block-meta";

    const label = document.createElement("span");
    label.className = "code-block-label";
    label.textContent = language;

    const stats = document.createElement("span");
    stats.className = "code-block-stats";
    stats.textContent = `${lineCount} ${lineCount === 1 ? "line" : "lines"}`;
    meta.append(label, stats);

    const actions = document.createElement("div");
    actions.className = "mermaid-actions";

    const sourceToggle = document.createElement("button");
    sourceToggle.type = "button";
    sourceToggle.className = "code-block-button";
    sourceToggle.textContent = "Show source";

    const copyButton = document.createElement("button");
    copyButton.type = "button";
    copyButton.className = "code-block-button icon-button icon-copy";
    copyButton.title = "Copy mermaid source";
    copyButton.setAttribute("aria-label", "Copy mermaid source");
    copyButton.addEventListener("click", async () => {
      await tools.copyText(source);
      flashButton(copyButton, "Copied mermaid source");
    });

    const modalButton = document.createElement("button");
    modalButton.type = "button";
    modalButton.className = "code-block-button icon-button icon-expand";
    modalButton.title = "Show full diagram";
    modalButton.setAttribute("aria-label", "Show full diagram");
    modalButton.addEventListener("click", async () => {
      const diagramStage = document.createElement("div");
      diagramStage.className = "mermaid-modal-stage";

      const modalDiagram = document.createElement("div");
      modalDiagram.className = "mermaid-diagram mermaid-diagram-modal";
      diagramStage.append(modalDiagram);

      const modal = tools.showModal({
        title: "Mermaid diagram",
        subtitle: `${lineCount} lines of source`,
        content: diagramStage,
        immersive: true,
        wide: true,
      });

      try {
        await waitForNextFrame();
        if (!modal.isActive()) {
          return;
        }

        const cleanup = await renderMermaidDiagram(modalDiagram, source, {
          fit: true,
          minZoom: 0.15,
          maxZoom: 12,
        });

        modal.setOnClose(cleanup);
      } catch (error) {
        modalDiagram.textContent = `Mermaid render error: ${String(error)}`;
        modalDiagram.classList.add("mermaid-error");
      }
    });

    const openButton = document.createElement("button");
    openButton.type = "button";
    openButton.className = "code-block-button icon-button icon-open-code";
    openButton.title = "Open code block";
    openButton.setAttribute("aria-label", "Open code block");
    openButton.addEventListener("click", () => {
      tools.vscode.postMessage({
        type: "openPreviewCodeBlock",
        language,
        content: source,
      });
    });

    actions.append(sourceToggle, copyButton, modalButton, openButton);
    toolbar.append(meta, actions);

    const diagramFrame = document.createElement("div");
    diagramFrame.className = "mermaid-diagram-frame";

    const diagram = document.createElement("div");
    diagram.className = "mermaid-diagram";
    diagramFrame.append(diagram);

    const sourcePanel = document.createElement("pre");
    sourcePanel.className = "mermaid-source hidden";
    sourcePanel.textContent = source;

    wrapper.append(toolbar, diagramFrame, sourcePanel);
    pre.replaceWith(wrapper);

    sourceToggle.addEventListener("click", () => {
      const hidden = sourcePanel.classList.toggle("hidden");
      sourceToggle.textContent = hidden ? "Show source" : "Hide source";
    });

    try {
      await renderMermaidDiagram(diagram, source, {
        fit: true,
        minZoom: 0.2,
        maxZoom: 10,
      });
    } catch (error) {
      diagram.textContent = `Mermaid render error: ${String(error)}`;
      diagram.classList.add("mermaid-error");
    }
  }
}

function createCodeModalContent(source, language) {
  const wrapper = document.createElement("div");
  wrapper.className = "modal-code-stage";

  const pre = document.createElement("pre");
  pre.className = "code-block-pre modal-code-pre";

  const code = document.createElement("code");
  if (language) {
    code.className = `language-${language}`;
  }
  code.textContent = source;
  applySyntaxHighlighting(code, language);

  pre.append(code);
  wrapper.append(pre);
  return wrapper;
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

  model.headers.forEach((header, index) => {
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
    text.textContent = header;
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
      .map((header, index) => ({ header, index }))
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

async function renderMermaidDiagram(container, source, panZoomOptions) {
  const { svg } = await mermaid.render(uid("mermaid"), source);
  container.innerHTML = svg;
  const svgElement = container.querySelector("svg");
  if (!svgElement) {
    return undefined;
  }

  svgElement.setAttribute("width", "100%");
  svgElement.setAttribute("height", "100%");
  svgElement.style.width = "100%";
  svgElement.style.height = "100%";
  const panZoom = svgPanZoom(svgElement, {
    zoomEnabled: true,
    controlIconsEnabled: true,
    fit: true,
    center: true,
    ...panZoomOptions,
  });

  return () => {
    try {
      panZoom.destroy();
    } catch (error) {
      if (
        !(error instanceof DOMException) ||
        error.name !== "InvalidStateError"
      ) {
        throw error;
      }
    }
  };
}

function waitForNextFrame() {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => {
      resolve();
    });
  });
}

function countLines(source) {
  if (!source) {
    return 0;
  }

  return source.replace(/\n$/, "").split("\n").length;
}

function containsPathToken(text) {
  return new RegExp(PATH_TOKEN_RE).test(text);
}

function getPathTokenMatches(text) {
  const matches = [];

  for (const match of text.matchAll(PATH_TOKEN_RE)) {
    const rawValue = match[2];
    if (!rawValue) {
      continue;
    }

    matches.push({
      prefix: match[1] || "",
      rawValue,
      index: match.index ?? 0,
    });
  }

  return matches;
}

function replacePathTokensInTextNode(node, tools, resolvedByHref) {
  if (!node.parentNode) {
    return;
  }

  const text = node.textContent || "";
  const fragment = document.createDocumentFragment();
  const anchors = [];
  let cursor = 0;

  for (const match of getPathTokenMatches(text)) {
    const resolution = resolvedByHref.get(match.rawValue);
    if (!resolution) {
      continue;
    }

    const startOffset = match.index + match.prefix.length;
    const endOffset = startOffset + match.rawValue.length;
    fragment.append(text.slice(cursor, startOffset));
    const anchor = createLocalLinkAnchor(match.rawValue, resolution);
    fragment.append(anchor);
    anchors.push(anchor);
    cursor = endOffset;
  }

  if (anchors.length === 0) {
    return;
  }

  fragment.append(text.slice(cursor));
  node.replaceWith(fragment);
  for (const anchor of anchors) {
    activateLocalLink(anchor, tools);
  }
}

function createLocalLinkAnchor(rawValue, resolution) {
  const anchor = document.createElement("a");
  anchor.href = "#";
  anchor.className = "preview-link preview-detected-link";
  anchor.dataset.localHref = rawValue;
  applyResolvedLocalLinkMetadata(anchor, resolution);
  anchor.textContent = rawValue;
  return anchor;
}

function applyResolvedLocalLinkMetadata(anchor, resolution) {
  const kind = resolution.isMarkdown ? "markdown" : "file";
  anchor.dataset.linkKind = kind;
  anchor.classList.remove("is-markdown-link", "is-file-link");
  anchor.classList.add(
    kind === "markdown" ? "is-markdown-link" : "is-file-link",
  );

  if (typeof resolution.tooltip === "string" && resolution.tooltip.length > 0) {
    anchor.dataset.previewTooltip = resolution.tooltip;
    return;
  }

  delete anchor.dataset.previewTooltip;
}

function activateLocalLink(anchor, tools) {
  if (
    !(anchor instanceof HTMLAnchorElement) ||
    anchor.dataset.linkEnhanced === "true"
  ) {
    return;
  }

  const href = anchor.getAttribute("data-local-href");
  if (!href) {
    return;
  }

  anchor.dataset.linkEnhanced = "true";
  anchor.addEventListener("click", (event) => {
    if (hasTextSelectionWithin(anchor)) {
      return;
    }

    event.preventDefault();
    tools.vscode.postMessage({ type: "openLocalLink", href });
  });

  if (anchor.querySelector("img, svg, table, pre, code, div")) {
    return;
  }

  let group = anchor.parentElement;
  if (
    !(group instanceof HTMLElement) ||
    !group.classList.contains("preview-link-group")
  ) {
    group = document.createElement("span");
    group.className = "preview-link-group";
    anchor.replaceWith(group);
    group.append(anchor);
  }

  group.classList.add("is-local-link");
  group.classList.toggle(
    "is-markdown-link",
    anchor.dataset.linkKind === "markdown",
  );
  group.classList.toggle(
    "is-file-link",
    anchor.dataset.linkKind !== "markdown",
  );
  group.dataset.localHref = href;

  if (anchor.dataset.previewTooltip) {
    group.dataset.previewTooltip = anchor.dataset.previewTooltip;
  }

  if (group.dataset.hoverPreviewBound !== "true") {
    group.dataset.hoverPreviewBound = "true";
    group.addEventListener("mouseenter", () => {
      void showLocalLinkHover(group, tools);
    });
    group.addEventListener("focusin", () => {
      void showLocalLinkHover(group, tools);
    });
    group.addEventListener("mouseleave", () => {
      if (localLinkHoverActiveGroup === group) {
        hideLocalLinkHover();
      }
    });
    group.addEventListener("focusout", (event) => {
      const nextTarget = event.relatedTarget;
      if (nextTarget instanceof Node && group.contains(nextTarget)) {
        return;
      }

      if (localLinkHoverActiveGroup === group) {
        hideLocalLinkHover();
      }
    });
  }
}

function ensureLocalLinkHoverCard() {
  if (!localLinkHoverCard) {
    localLinkHoverCard = document.createElement("div");
    localLinkHoverCard.className = "preview-link-hover-card";
    localLinkHoverCard.setAttribute("aria-hidden", "true");
    document.body.append(localLinkHoverCard);
  }

  if (!localLinkHoverListenersBound) {
    localLinkHoverListenersBound = true;
    window.addEventListener(
      "scroll",
      () => {
        hideLocalLinkHover();
      },
      { passive: true },
    );
    window.addEventListener(
      "resize",
      () => {
        hideLocalLinkHover();
      },
      { passive: true },
    );
  }

  return localLinkHoverCard;
}

async function showLocalLinkHover(group, tools) {
  const href = group.dataset.localHref;
  if (!href) {
    return;
  }

  const card = ensureLocalLinkHoverCard();
  const requestToken = ++localLinkHoverRequestToken;

  if (
    localLinkHoverActiveGroup &&
    localLinkHoverActiveGroup !== group &&
    localLinkHoverActiveGroup instanceof HTMLElement
  ) {
    localLinkHoverActiveGroup.classList.remove("is-hover-preview-active");
  }

  localLinkHoverActiveGroup = group;
  group.classList.add("is-hover-preview-active");
  renderLocalLinkHoverLoading(card, href);
  positionLocalLinkHoverCard(card, group);

  const preview = await tools.requestPreviewLinkHover(href);
  if (
    requestToken !== localLinkHoverRequestToken ||
    localLinkHoverActiveGroup !== group
  ) {
    return;
  }

  if (!preview) {
    hideLocalLinkHover();
    return;
  }

  renderLocalLinkHoverPreview(card, preview);
  positionLocalLinkHoverCard(card, group);
}

function hideLocalLinkHover() {
  localLinkHoverRequestToken += 1;

  if (localLinkHoverActiveGroup instanceof HTMLElement) {
    localLinkHoverActiveGroup.classList.remove("is-hover-preview-active");
  }

  localLinkHoverActiveGroup = undefined;

  if (!localLinkHoverCard) {
    return;
  }

  localLinkHoverCard.classList.remove("is-visible");
  localLinkHoverCard.setAttribute("aria-hidden", "true");
  localLinkHoverCard.style.left = "-9999px";
  localLinkHoverCard.style.top = "-9999px";
}

function renderLocalLinkHoverLoading(card, href) {
  const fragment = document.createDocumentFragment();

  fragment.append(
    createHoverTextElement("h3", "preview-link-hover-title", href),
    createHoverTextElement(
      "p",
      "preview-link-hover-message is-loading",
      "Loading preview...",
    ),
  );

  card.replaceChildren(fragment);
  card.classList.add("is-visible");
  card.setAttribute("aria-hidden", "false");
}

function renderLocalLinkHoverPreview(card, preview) {
  const fragment = document.createDocumentFragment();
  const headerText = preview.location
    ? `${preview.displayPath} - ${preview.location}`
    : preview.displayPath;

  fragment.append(
    createHoverTextElement("h3", "preview-link-hover-title", headerText),
  );

  if (preview.note) {
    fragment.append(
      createHoverTextElement("p", "preview-link-hover-note", preview.note),
    );
  }

  if (preview.code) {
    const pre = document.createElement("pre");
    pre.className = "preview-link-hover-code modal-code-pre";

    const code = document.createElement("code");
    if (preview.language) {
      code.className = `language-${preview.language}`;
    }
    code.textContent = preview.code;

    applySyntaxHighlighting(code, preview.language);

    pre.append(code);
    fragment.append(pre);
  } else if (preview.message) {
    fragment.append(
      createHoverTextElement(
        "p",
        "preview-link-hover-message",
        preview.message,
      ),
    );
  }

  if (Array.isArray(preview.entries) && preview.entries.length > 0) {
    const list = document.createElement("ul");
    list.className = "preview-link-hover-list";

    for (const entry of preview.entries) {
      const item = document.createElement("li");
      item.textContent = entry.label;
      list.append(item);
    }

    fragment.append(list);
  }

  if (preview.footer) {
    fragment.append(
      createHoverTextElement("p", "preview-link-hover-footer", preview.footer),
    );
  }

  card.replaceChildren(fragment);
  card.classList.add("is-visible");
  card.setAttribute("aria-hidden", "false");
}

function createHoverTextElement(tagName, className, text) {
  const element = document.createElement(tagName);
  element.className = className;
  element.textContent = text;
  return element;
}

function positionLocalLinkHoverCard(card, group) {
  const linkRect = group.getBoundingClientRect();
  const viewportPadding = 12;
  const maxWidth = Math.min(540, window.innerWidth - viewportPadding * 2);

  card.style.maxWidth = `${maxWidth}px`;
  card.style.left = "0px";
  card.style.top = "0px";

  const cardRect = card.getBoundingClientRect();
  let left = linkRect.left;
  let top = linkRect.bottom + 10;

  if (left + cardRect.width > window.innerWidth - viewportPadding) {
    left = window.innerWidth - cardRect.width - viewportPadding;
  }

  if (top + cardRect.height > window.innerHeight - viewportPadding) {
    top = linkRect.top - cardRect.height - 10;
  }

  card.style.left = `${Math.max(viewportPadding, Math.round(left))}px`;
  card.style.top = `${Math.max(viewportPadding, Math.round(top))}px`;
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
    .map((header, index) => ({ header, index }))
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
        room: width - floorWidths[index],
      }))
      .filter((item) => item.room > 0.5);

    if (shrinkable.length === 0) {
      break;
    }

    const totalRoom = shrinkable.reduce((sum, item) => sum + item.room, 0);
    for (const item of shrinkable) {
      const share = Math.min(item.room, (overflow * item.room) / totalRoom);
      nextWidths[item.index] -= share;
      overflow -= share;
    }
  }

  visibleColumns.forEach(({ index }, visibleIndex) => {
    state.columnWidths.set(
      index,
      Math.round(
        clamp(
          nextWidths[visibleIndex],
          floorWidths[visibleIndex],
          TABLE_COLUMN_GROWTH_LIMIT,
        ),
      ),
    );
  });
}

function getColumnFloorWidth(model, columnIndex, header) {
  const samples = [header, ...model.rows.map((row) => row[columnIndex] ?? "")]
    .map((value) => normalizeTableCellText(value))
    .filter(Boolean)
    .slice(0, 8);
  const longestWord = samples.reduce((current, value) => {
    const maxWord = value
      .split(/\s+/)
      .reduce((len, word) => Math.max(len, word.length), 0);
    return Math.max(current, maxWord);
  }, 0);
  return clamp(longestWord * 8 + 48, 136, 220);
}

function getInitialColumnWidth(model, columnIndex, header) {
  const samples = [header, ...model.rows.map((row) => row[columnIndex] ?? "")]
    .map((value) => normalizeTableCellText(value))
    .filter(Boolean)
    .slice(0, 10);

  const longest = samples.reduce(
    (current, value) => Math.max(current, value.length),
    0,
  );

  return clamp(
    longest * 7.4 + 44,
    getColumnFloorWidth(model, columnIndex, header),
    TABLE_COLUMN_MAX_WIDTH,
  );
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function isLikelyMarkdownHref(href) {
  const normalized = href.split(/[?#]/, 1)[0].toLowerCase();
  return (
    !normalized ||
    normalized.endsWith(".md") ||
    normalized.endsWith(".markdown") ||
    normalized.endsWith(".mdx") ||
    normalized.endsWith(".qmd") ||
    normalized.endsWith(".prompt.md") ||
    normalized.endsWith(".instructions.md")
  );
}

function flashButton(button, label) {
  const originalTitle = button.title;
  const originalLabel = button.getAttribute("aria-label");
  button.classList.add("is-confirmed");
  button.title = label;
  button.setAttribute("aria-label", label);
  window.setTimeout(() => {
    button.classList.remove("is-confirmed");
    button.title = originalTitle;
    if (originalLabel) {
      button.setAttribute("aria-label", originalLabel);
    }
  }, 1600);
}

function getLanguageLabel(code) {
  const match = [...code.classList].find((value) =>
    value.startsWith("language-"),
  );
  return match ? match.slice("language-".length) : "";
}

function applySyntaxHighlighting(code, language) {
  const resolvedLanguage = resolveHighlightLanguage(language);
  if (resolvedLanguage) {
    code.classList.remove(
      ...[...code.classList].filter((value) => value.startsWith("language-")),
    );
    code.classList.add(`language-${resolvedLanguage}`);
    hljs.highlightElement(code);
    return;
  }

  code.classList.add("hljs");
}

function resolveHighlightLanguage(language) {
  if (!language) {
    return undefined;
  }

  const candidates = getHighlightLanguageCandidates(language);
  return candidates.find((candidate) => hljs.getLanguage(candidate));
}

function getHighlightLanguageCandidates(language) {
  const normalized = language.trim().toLowerCase();
  const aliases = {
    javascriptreact: ["tsx", "jsx", "typescript", "javascript"],
    typescriptreact: ["tsx", "typescript", "jsx", "javascript"],
    javascript: ["javascript", "js"],
    typescript: ["typescript", "ts"],
    jsx: ["jsx", "javascript", "xml"],
    tsx: ["tsx", "typescript", "jsx", "javascript"],
    shellscript: ["bash", "shell", "sh"],
  };

  const extra = aliases[normalized] ?? [];
  return [normalized, ...extra];
}

function uid(prefix) {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}
