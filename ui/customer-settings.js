// Customer-owned integrations. Provider and hardware secrets remain in page memory only.
export function customerSettings({ h, api, state, refresh, enter }) {
  const root = h("div", { class: "customer-settings", id: "account-settings" });
  const text = (message, kind = "") =>
    h("p", { class: "msg " + kind, role: "status" }, message);
  const input = (label, name, type = "text", extra = {}) =>
    h(
      "label",
      null,
      label,
      h("input", {
        name,
        type,
        required: true,
        autocomplete: type === "password" ? "current-password" : "off",
        ...extra,
      }),
    );
  const button = (label, fn) =>
    h("button", { type: "button", onclick: fn }, label);
  const feedback = text("");
  async function send(path, method, body, where = feedback) {
    where.textContent = "Working…";
    const r = await api(path, method, body);
    where.textContent = r.ok ? "" : r.data.error || "Please try again.";
    return r;
  }
  function form(fields, label, fn) {
    const status = text("");
    const submit = h("button", { type: "submit", class: "primary" }, label);
    return h(
      "form",
      {
        onsubmit: async (e) => {
          e.preventDefault();
          submit.disabled = true;
          try {
            await fn(
              Object.fromEntries(new FormData(e.target)),
              status,
              e.target,
            );
          } catch {
            status.textContent = "Could not complete that request. Try again.";
          } finally {
            submit.disabled = false;
          }
        },
      },
      ...fields,
      submit,
      status,
    );
  }
  function credentials(data, host) {
    const key = h("input", {
      type: "password",
      value: data.deviceKey,
      readonly: true,
      "aria-label": "One-time device key",
      autocomplete: "off",
    });
    const note = text(
      "Save this key privately. It is shown only on this page. Never paste it into an AI chat.",
    );
    host.replaceChildren(
      h("h3", null, data.serial ? "Your box is registered" : "Your replacement key"),
      h("p", null, "Device ID: ", h("code", null, data.deviceId)),
      data.serial && h("p", null, "Serial: ", h("code", null, data.serial)),
      key,
      button("Copy device key", async () => {
        try {
          await navigator.clipboard.writeText(key.value);
          note.textContent =
            "Copied. Keep the key in your box’s private settings.";
        } catch {
          note.textContent =
            "Clipboard unavailable. Select the key and copy it yourself.";
          key.type = "text";
          key.select();
        }
      }),
      h("a", { href: "/build" }, "Setup guide"),
      button("Hide key", () => {
        key.value = "";
        host.replaceChildren(
          text("Key hidden. You can replace it below if needed."),
        );
      }),
      note,
    );
  }
  const created = h("div", { class: "credential-result" }),
    rotation = h("div", { class: "settings-stack" });
  const build = form(
    [
      input("Box name", "name", "text", { maxlength: 60 }),
      input("Installation address", "address", "text", {
        maxlength: 300,
        autocomplete: "street-address",
      }),
      h(
        "p",
        { class: "fine" },
        "The address is sent to the U.S. Census address service to place your box on the map.",
      ),
      input("Current password", "password", "password", { maxlength: 512 }),
      h(
        "label",
        { class: "check" },
        h("input", { type: "checkbox", name: "consent" }),
        "The response team may contact me about this box.",
      ),
    ],
    "Register my box",
    async (f, status, el) => {
      build.requestId ||= crypto.randomUUID();
      const r = await send(
        "/api/customer/build",
        "POST",
        { ...f, consent: !!f.consent, requestId: build.requestId },
        status,
      );
      if (r.ok) {
        el.reset();
        build.requestId = null;
        credentials(r.data, created);
        await refresh();
        await loadBoxes();
      }
    },
  );
  const buildPanel = h(
    "details",
    {
      class: "card",
      open: new URLSearchParams(location.search).get("setup") === "build",
    },
    h("summary", null, "Build your own box"),
    h(
      "p",
      { class: "muted" },
      "Register your hardware, save its private key, then send real readings. Up to five self-built boxes per account.",
    ),
    h("a", { href: "/build" }, "Read the setup guide"),
    build,
    created,
    rotation,
  );
  root.append(buildPanel);
  async function loadBoxes() {
    const r = await api("/api/customer/build");
    if (!r.ok) return;
    rotation.replaceChildren(
      ...r.data.boxes.map((box) =>
        h(
          "details",
          null,
          h("summary", null, "Replace key: " + box.name),
          form(
            [
              h(
                "p",
                { class: "fine" },
                "The old key will stop working. Update your box with the replacement.",
              ),
              input("Current password", "password", "password", {
                maxlength: 512,
              }),
            ],
            "Replace device key",
            async (f, status, el) => {
              const result = await send(
                "/api/customer/build",
                "PATCH",
                { ...f, linkId: box.id },
                status,
              );
              if (result.ok) {
                el.reset();
                credentials(result.data, created);
              }
            },
          ),
        ),
      ),
    );
  }
  const connections = h("div", { class: "settings-stack" }),
    connectionStatus = text("");
  const mcpUrl = location.origin + "/mcp";
  const connectionPanel = h(
    "details",
    { class: "card" },
    h("summary", null, "Connect ChatGPT or Claude"),
    h(
      "p",
      null,
      "Add HomeBeacon as a custom MCP connection in your assistant, then sign in here to approve access.",
    ),
    h("code", { class: "copy-value" }, mcpUrl),
    button("Copy connection URL", async () => {
      try {
        await navigator.clipboard.writeText(mcpUrl);
        connectionStatus.textContent = "Connection URL copied.";
      } catch {
        connectionStatus.textContent = "Select and copy the URL above.";
      }
    }),
    h(
      "p",
      { class: "fine" },
      "Only your device conditions, recent readings and setup guide are shared. No address, password, device key or operator notes. Your assistant’s plan and workspace settings must allow custom connections.",
    ),
    h("a", { href: "/build#assistants" }, "Connection instructions"),
    connections,
    connectionStatus,
  );
  root.append(connectionPanel);
  async function loadConnections() {
    const r = await api("/api/customer/connections");
    if (!r.ok) return;
    connections.replaceChildren(
      ...r.data.connections.map((c) =>
        h(
          "div",
          { class: "row" },
          h("span", null, c.name),
          button("Disconnect", async () => {
            const r = await send(
              "/api/customer/connections?id=" + encodeURIComponent(c.id),
              "DELETE",
              undefined,
              connectionStatus,
            );
            if (r.ok) {
              connectionStatus.textContent = "Disconnected.";
              await loadConnections();
            }
          }),
        ),
      ),
    );
    if (!r.data.connections.length)
      connections.append(h("p", { class: "fine" }, "No assistants connected."));
  }
  const providerStatus = text("Loading settings…"),
    questionResult = text(""),
    pick = h(
      "select",
      {
        name: "linkId",
        "aria-label": "Question about",
        id: "assistant-device",
      },
      h("option", { value: "" }, "Building and setup"),
    );
  const keyForm = form(
    [
      input("NVIDIA API key", "apiKey", "password", {
        autocomplete: "new-password",
        maxlength: 1024,
      }),
      input("Current password", "password", "password", { maxlength: 512 }),
      h(
        "p",
        { class: "fine" },
        "Stored encrypted on HomeBeacon. Only your account can use it. NVIDIA usage may count toward your provider allowance.",
      ),
    ],
    "Save NVIDIA key",
    async (f, status, el) => {
      const r = await send("/api/customer/assistant", "PUT", f, status);
      if (r.ok) {
        el.reset();
        providerStatus.textContent =
          "Key saved. It will be checked when you ask a question.";
      }
    },
  );
  const askForm = form(
    [
      h("label", null, "Question about", pick),
      input("Your question", "question", "text", { maxlength: 1000 }),
      h(
        "label",
        { class: "check" },
        h("input", { name: "shareData", type: "checkbox", required: true }),
        "Send this question and the selected box’s reports to NVIDIA.",
      ),
    ],
    "Ask NVIDIA",
    async (f, status) => {
      questionResult.textContent = "";
      const r = await send(
        "/api/customer/assistant",
        "POST",
        { ...f, shareData: !!f.shareData },
        status,
      );
      if (r.ok) {
        questionResult.textContent = r.data.answer;
        status.textContent = r.data.note;
      }
    },
  );
  root.append(
    h(
      "details",
      { class: "card" },
      h("summary", null, "Use your NVIDIA key"),
      providerStatus,
      keyForm,
      button("Remove saved key", async () => {
        const r = await send(
          "/api/customer/assistant",
          "DELETE",
          undefined,
          providerStatus,
        );
        if (r.ok) {
          providerStatus.textContent = "Key removed.";
          questionResult.textContent = "";
        }
      }),
      askForm,
      questionResult,
    ),
  );
  root.append(
    h(
      "details",
      { class: "card" },
      h("summary", null, "Account settings"),
      h("p", null, "Signed in as ", state.user.email),
      form(
        [
          input("New email", "email", "email", {
            maxlength: 254,
            autocomplete: "email",
          }),
          input("Confirm new email", "confirmEmail", "email", {
            maxlength: 254,
          }),
          input("Current password", "password", "password", { maxlength: 512 }),
          h(
            "p",
            { class: "fine" },
            "Changes your sign-in email. No verification email is sent. Your boxes stay linked. Household sharing ends and must be set up again. Other sessions and assistant connections will be signed out.",
          ),
        ],
        "Change email",
        async (f, status, el) => {
          const r = await send("/api/customer/account", "PATCH", f, status);
          if (r.ok) {
            el.reset();
            await enter();
          }
        },
      ),
    ),
    feedback,
  );
  const pending = new URLSearchParams(location.search).get("connect");
  if (pending) {
    const consent = h(
      "section",
      { class: "card connection-consent" },
      h("h2", null, "Connect your assistant"),
      text("Loading connection request…"),
    );
    root.prepend(consent);
    api(
      "/api/customer/connections?pending=" + encodeURIComponent(pending),
    ).then((r) => {
      if (!r.ok) {
        consent.replaceChildren(
          text(r.data.error || "Connection request expired."),
        );
        return;
      }
      const status = text("");
      const decision = async (value) => {
        for (const b of consent.querySelectorAll("button")) b.disabled = true;
        const result = await send(
          "/api/customer/connections",
          "POST",
          { requestId: pending, decision: value },
          status,
        );
        if (result.ok) location.assign(result.data.redirect);
        else
          for (const b of consent.querySelectorAll("button"))
            b.disabled = false;
      };
      consent.replaceChildren(
        h("h2", null, "Allow this assistant to read your boxes?"),
        h("p", null, "App name: " + r.data.name),
        h("p", null, "Returns to: " + r.data.callbackHost),
        h(
          "p",
          null,
          "It can read your conditions, recent sensor readings and setup instructions. It cannot change your devices, send messages or dispatch help.",
        ),
        h(
          "p",
          { class: "fine" },
          "The app supplied this name. Only continue if you started this connection and recognize its return address. Reports shared with the assistant follow its own data policy.",
        ),
        h(
          "div",
          { class: "row" },
          button("Cancel", () => decision("deny")),
          h(
            "button",
            {
              type: "button",
              class: "primary",
              onclick: () => decision("allow"),
            },
            "Allow access",
          ),
        ),
        status,
      );
    });
  }
  Promise.all([
    loadBoxes(),
    loadConnections(),
    api("/api/customer/assistant").then((r) => {
      providerStatus.textContent = r.ok
        ? r.data.configured
          ? "NVIDIA key saved."
          : "No NVIDIA key saved."
        : r.data.error;
    }),
    api("/api/customer/devices").then((r) => {
      if (r.ok)
        pick.append(
          ...r.data.devices.map((d) =>
            h("option", { value: d.id }, d.nickname),
          ),
        );
    }),
  ]).catch(() => {
    feedback.textContent =
      "Some settings could not load. Refresh to try again.";
  });
  return root;
}
