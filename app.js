/* =========================================================
   Havenly app logic
   =========================================================
   This file connects the page controls to the app features:
   navigation, maintenance events, appliances, professionals,
   the Maintenance Max chat, account settings, and authentication.
*/

/* =========================================================
   Supabase connection
   ========================================================= */

// This browser key is intended for client-side use. Database access
// is still controlled by the Supabase project's row-level security.
const SUPABASE_URL = "https://bspemalirnvoomqtgwjd.supabase.co";
const SUPABASE_PUBLISHABLE_KEY =
  "sb_publishable_Wvv2VOeFPJbrq92p5M0vAA_1uqt5E3J";

const supabaseClient = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY
);

/* =========================================================
   App data
   ========================================================= */

const pages = [
  "home",
  "maintenance",
  "appliances",
  "appliance-details",
  "professionals",
  "professional-profile",
  "assistant"
];

const pageNames = {
  home: "Overview",
  maintenance: "Maintenance Log",
  appliances: "My Appliances",
  "appliance-details": "Appliance Details",
  professionals: "Professionals",
  "professional-profile": "Professional Profile",
  assistant: "Maintenance Max"
};

let currentPage = "home";
let selectedAppliance = null;
let applianceBeingEdited = null;
let maintenanceApplianceFilter = null;
// Stores the appliance while its deletion is awaiting confirmation.
let appliancePendingDelete = null;

// Keep the sample maintenance events used by the calendar and list.
let events = [
  {
    name: "Replace HVAC Filter",
    category: "HVAC",
    date: "2026-09-30",
    time: "9:00 AM",
    description: "Replace the filter to keep air quality fresh.",
    status: "Upcoming"
  },
  {
    name: "Clean Dryer Vent",
    category: "Laundry",
    date: "2026-10-03",
    time: "10:30 AM",
    description: "Clear lint buildup and inspect the vent line.",
    status: "Upcoming"
  },
  {
    name: "Refrigerator Filter",
    category: "Kitchen",
    date: "2026-10-14",
    time: "9:00 AM",
    description: "Replace the water and ice filter.",
    status: "Upcoming"
  },
  {
    name: "Water Heater Inspection",
    category: "Plumbing",
    date: "2026-10-22",
    time: "2:00 PM",
    description: "Annual inspection and pressure relief check.",
    status: "Upcoming"
  },
  {
    name: "Test Smoke Detectors",
    category: "General",
    date: "2026-09-12",
    time: "11:00 AM",
    description: "Test each detector and replace batteries as needed.",
    status: "Completed"
  }
];

// Appliance records are loaded from Supabase after sign-in.
// Start in the loading state so the page does not briefly show
// the first-time empty screen while the database request is pending.
let appliances = [];
let appliancesLoading = true;

// Sample professional listings used by the Professionals page.
const professionals = [
  {
    name: "Evergreen Home Services",
    logo: "E",
    rating: "4.9",
    reviews: "128 reviews",
    distance: "1.8 mi",
    availability: "Today at 4:30 PM",
    description: "Friendly appliance repair from a trusted local team.",
    category: "Appliance specialist"
  },
  {
    name: "FixRight Appliance Co.",
    logo: "F",
    rating: "4.8",
    reviews: "96 reviews",
    distance: "3.2 mi",
    availability: "Tomorrow at 9:00 AM",
    description: "Fast, honest repairs for all major appliance brands.",
    category: "Appliance repair"
  },
  {
    name: "Boulder Handy Home",
    logo: "B",
    rating: "4.7",
    reviews: "74 reviews",
    distance: "4.5 mi",
    availability: "Fri, Oct 3",
    description: "Home maintenance and preventative care made easy.",
    category: "General home repair"
  }
];

/* =========================================================
   Shared helpers
   ========================================================= */

// Find one element or a list of elements using a CSS selector.
const $ = (selector, parent = document) =>
  parent.querySelector(selector);

const $$ = (selector, parent = document) =>
  [...parent.querySelectorAll(selector)];

// Keep date parsing at midday to avoid timezone shifts that can
// move a displayed date to the previous or following day.
function formatDate(dateString) {
  const date = new Date(dateString + "T12:00:00");

  return {
    month: date
      .toLocaleString("en-US", { month: "short" })
      .toUpperCase(),
    day: date.getDate(),
    full: date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric"
    })
  };
}

// Show a short confirmation or error message in the toast area.
function showToast(title, message) {
  $("#toastTitle").textContent = title;
  $("#toastMessage").textContent = message;
  $("#toast").classList.add("show");

  setTimeout(() => {
    $("#toast").classList.remove("show");
  }, 3200);
}

// Open or close a modal and prevent the page behind it from scrolling.
function openModal(id) {
  $("#" + id).classList.add("open");
  document.body.classList.add("modal-open");
}

function closeModal(id) {
  $("#" + id).classList.remove("open");

  // Keep the page locked if another modal is still open.
  const anotherModalIsOpen =
    $(".modal-backdrop.open") !== null;

  document.body.classList.toggle(
    "modal-open",
    anotherModalIsOpen
  );
}

// Use the matching CSS status color for appliance and event labels.
function statusClass(status) {
  if (status === "Up to date" || status === "Completed") {
    return "green";
  }

  if (status === "Overdue") {
    return "orange";
  }

  return "gray";
}

/* =========================================================
   Page navigation
   ========================================================= */

// Switch the visible page and keep the URL hash in sync.
function navigate(page, updateHistory = true) {
  if (!pages.includes(page)) {
    page = "home";
  }

  if (updateHistory && location.hash !== "#" + page) {
    history.pushState(null, "", "#" + page);
  }

  currentPage = page;

  pages.forEach(pageName => {
    const pageElement = $("#page-" + pageName);

    if (pageElement) {
      pageElement.classList.toggle(
        "active-page",
        pageName === page
      );
    }
  });

  // Keep parent navigation items highlighted for detail pages.
  $$(".nav-item").forEach(item => {
    const isCurrentPage = item.dataset.page === page;
    const isApplianceDetail =
      page === "appliance-details" &&
      item.dataset.page === "appliances";
    const isProfessionalDetail =
      page === "professional-profile" &&
      item.dataset.page === "professionals";

    item.classList.toggle(
      "active",
      isCurrentPage || isApplianceDetail || isProfessionalDetail
    );
  });

  $("#breadcrumbs").innerHTML =
    "<span>Home</span>" +
    '<span class="crumb-separator">/</span>' +
    "<strong>" + pageNames[page] + "</strong>";

  $("#sidebar").classList.remove("open");
  window.scrollTo({ top: 0, behavior: "smooth" });

  // Refresh the page-specific content whenever a page is opened.
  if (page === "maintenance") {
    renderCalendar();
    renderEvents();
  }

  if (page === "appliances") {
    renderAppliances();
  }

  if (page === "professionals") {
    renderProfessionals();
  }
}

/* =========================================================
   Maintenance events
   ========================================================= */

// Draw the small upcoming-events list on the home page.
function renderMiniEvents() {
  const upcomingEvents = events
    .filter(event => event.status !== "Completed")
    .slice(0, 3);

    

  $("#miniEventList").innerHTML = upcomingEvents
    .map(event => {
      const date = formatDate(event.date);

      

      return (
        '<div class="mini-event">' +
          '<div class="event-date">' +
            "<span>" + date.month + "</span>" +
            "<b>" + date.day + "</b>" +
          "</div>" +
          '<div class="mini-event-info">' +
            "<strong>" + event.name + "</strong>" +
            "<span>" + event.time + " · " + event.category + "</span>" +
          "</div>" +
          '<span class="event-category">Upcoming</span>' +
        "</div>"
      );
    })
    .join("");
}

function populateEventAppliances() {
  const select = $("#eventAppliance");
  const selectedValue = select.value;

  select.innerHTML =
    '<option value="">General home maintenance</option>' +
    appliances.map(appliance =>
      '<option value="' + appliance.id + '">' +
        appliance.name +
      '</option>'
    ).join("");

  select.value = selectedValue;
}

// Draw the September 2026 calendar and place events on their dates.
function renderCalendar() {
  const daysOfWeek = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const firstDayOfMonth = new Date(2026, 8, 1).getDay();
  const daysInMonth = 30;

  const cells = daysOfWeek.map(day =>
    '<div class="calendar-day-name">' + day + "</div>"
  );

  // Add blank cells before the first day of the month.
  for (let index = 0; index < firstDayOfMonth; index += 1) {
    cells.push('<div class="calendar-cell muted-day"></div>');
  }

  // Add one calendar cell for each day, including that day's events.
  for (let day = 1; day <= daysInMonth; day += 1) {
    const isoDate = "2026-09-" + String(day).padStart(2, "0");
    const dayEvents = events.filter(event => event.date === isoDate);
    const isToday = day === 30;

    const eventMarkup = dayEvents
      .map((event, index) => {
        let eventColor = "";

        if (index % 3 === 1) {
          eventColor = " peach-event";
        } else if (index % 3 === 2) {
          eventColor = " purple-event";
        }

        return (
          '<span class="calendar-event' + eventColor + '"' +
            ' title="' + event.description + '">' +
            event.name +
          "</span>"
        );
      })
      .join("");

    cells.push(
      '<div class="calendar-cell' + (isToday ? " today" : "") + '">' +
        '<span class="day-number">' + day + "</span>" +
        eventMarkup +
      "</div>"
    );
  }

  // Complete the final calendar row with blank cells.
  while (cells.length < 49) {
    cells.push('<div class="calendar-cell muted-day"></div>');
  }

  $("#calendarGrid").innerHTML = cells.join("");
  renderMiniEvents();
}

// Draw the maintenance list in date order and connect completion buttons.
function renderEvents() {
  const sortedEvents = events
    .filter(event =>
      !maintenanceApplianceFilter ||
      String(event.applianceId) === String(maintenanceApplianceFilter)
    )
    .sort((first, second) => first.date.localeCompare(second.date));

  $("#eventList").innerHTML = sortedEvents
    .map(event => {
      const date = formatDate(event.date);
      
      const linkedAppliance = appliances.find(
  appliance => String(appliance.id) === String(event.applianceId)
);

const applianceLabel = linkedAppliance
  ? " · " + linkedAppliance.name
  : "";



      const eventIndex = events.indexOf(event);
      const completionControl =
        event.status !== "Completed"
          ? '<button class="event-complete" data-complete="' +
            eventIndex +
            '" title="Mark completed">✓</button>'
          : '<span class="event-complete">✓</span>';

      return (
        '<div class="event-card">' +
          '<div class="event-card-date">' +
            "<span>" + date.month + "</span>" +
            "<b>" + date.day + "</b>" +
          "</div>" +
          '<div class="event-card-body">' +
            "<strong>" + event.name + "</strong>" +
            "<small>" + event.category + " · " + event.time + applianceLabel + "</small>" +
            '<p class="event-description">' + event.description + "</p>" +
          "</div>" +
          '<span class="status-pill ' + statusClass(event.status) + '">' +
            event.status +
          "</span>" +
          completionControl +
        "</div>"
      );
    })
    .join("");

  $$("[data-complete]").forEach(button => {
    button.addEventListener("click", () => {
      const eventIndex = Number(button.dataset.complete);

      events[eventIndex].status = "Completed";

      renderEvents();
      renderCalendar();

      showToast(
        "Task completed",
        "Nice work keeping your home on track."
      );
    });
  });
}

/* =========================================================
   Appliance loading and display
   ========================================================= */

// Load the signed-in user's appliance records from Supabase.
async function loadAppliances() {
  appliancesLoading = true;
  renderAppliances();

  try {
    const {
      data: savedAppliances,
      error
    } = await supabaseClient
      .from("appliances")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      throw error;
    }

    // Convert database fields to the format used by the appliance cards.
    appliances = (savedAppliances || []).map(appliance => ({
      id: appliance.appliance_id,
      name: appliance.name,
      type: appliance.type,
      brand: appliance.brand || "",
      model: appliance.model || "",
      category: appliance.category,
      purchaseDate: appliance.purchase_date || "",
      lastMaintenanceDate: appliance.last_maintenance_date || "",

      last: appliance.last_maintenance_date
        ? formatDate(appliance.last_maintenance_date).full
        : "Not yet serviced",

     // No maintenance status or next date has been calculated yet.
      next: "Not scheduled",
      status: "Not recorded",
      icon: "▤",
      tone: "",

      purchase: appliance.purchase_date
    ? formatDate(appliance.purchase_date).full
    : "Not provided"
    }));
  } catch (error) {
    console.error("Supabase appliance error:", error);

    showToast(
      "Error",
      error.message || "Unable to load your appliances."
    );
  } finally {
    appliancesLoading = false;
    renderAppliances();
  }
}

// Create the standard appliance icon used on each card.
function iconFor(appliance) {
  return (
    '<div class="appliance-icon ' + appliance.tone + '">' +
      appliance.icon +
    "</div>"
  );
}

// Set the appliance name and open the confirmation modal.
function openDeleteApplianceModal(applianceId) {
  appliancePendingDelete = appliances.find(
    appliance => String(appliance.id) === String(applianceId)
  );

  if (!appliancePendingDelete) {
    return;
  }

  $("#deleteApplianceName").textContent =
    appliancePendingDelete.name;

  openModal("deleteApplianceModal");
}

// Delete the appliance from Supabase after the user confirms.
async function removeAppliance(applianceId) {
  const appliance = appliances.find(
    item => String(item.id) === String(applianceId)
  );

  if (!appliance) {
    return false;
  }

  try {
    const { data: deletedAppliance, error } = await supabaseClient
      .from("appliances")
      .delete()
      .eq("appliance_id", appliance.id)
      .select("appliance_id")
      .maybeSingle();

    if (error) {
      throw error;
    }

    if (!deletedAppliance) {
      showToast(
        "Appliance not deleted",
        "Refresh the page and try again."
      );
      return false;
    }

    const deletingSelectedAppliance =
      selectedAppliance &&
      String(selectedAppliance.id) === String(appliance.id);

    appliances = appliances.filter(
      item => String(item.id) !== String(appliance.id)
    );

    if (deletingSelectedAppliance) {
      selectedAppliance = null;
      $("#deleteDetailApplianceButton").disabled = true;
    }

    if (
      deletingSelectedAppliance &&
      currentPage === "appliance-details"
    ) {
      navigate("appliances");
    } else {
      renderAppliances();
    }

    showToast(
      "Appliance deleted",
      appliance.name + " was removed."
    );

    return true;
  } catch (error) {
    console.error("Appliance deletion error:", error);

    showToast(
      "Error",
      error.message || "The appliance could not be deleted."
    );

    return false;
  }
}

// Draw appliance cards, the loading state, or the first-appliance message.
function renderAppliances() {
  const searchQuery = ($("#applianceSearch").value || "").toLowerCase();
  const category = $("#categoryFilter").value;

  if (appliancesLoading) {
    $("#applianceCount").textContent = "Loading...";

    $("#applianceGrid").innerHTML =
      '<div class="appliance-empty-state" role="status">' +
        '<div class="appliance-empty-icon loading-spinner"></div>' +
        "<h2>Getting your home ready...</h2>" +
        "<p>Gathering your saved appliances. This will just take a moment.</p>" +
      "</div>";

    return;
  }

  const filteredAppliances = appliances.filter(appliance => {
    const matchesCategory =
      category === "all" || appliance.category === category;
    const searchableValues = [
      appliance.name,
      appliance.type,
      appliance.brand,
      appliance.category
    ]
      .join(" ")
      .toLowerCase();

    return matchesCategory && searchableValues.includes(searchQuery);
  });

  $("#applianceCount").textContent =
    filteredAppliances.length +
    " appliance" +
    (filteredAppliances.length === 1 ? "" : "s");

  // Give a first-time visitor a clear path to add their first appliance.
  const hasNoAppliances =
    appliances.length === 0 &&
    searchQuery === "" &&
    category === "all";

  if (hasNoAppliances) {
    $("#applianceGrid").innerHTML =
      '<div class="appliance-empty-state">' +
        '<div class="appliance-empty-icon" aria-hidden="true">⌂</div>' +
        '<span class="eyebrow">A LITTLE MORE PEACE OF MIND</span>' +
        "<h2>Your home’s appliance list starts here</h2>" +
        "<p>" +
          "Add your first appliance to keep its details and care history " +
          "together in one handy place." +
        "</p>" +
        '<button class="button button-primary" id="emptyStateAddAppliance">' +
          "<span>＋</span> Add your first appliance" +
        "</button>" +
      "</div>";

   $("#emptyStateAddAppliance").addEventListener("click", () => {
  applianceBeingEdited = null;
  $("#applianceForm").reset();
  $("#applianceModalTitle").textContent = "Add appliance";
  openModal("applianceModal");
});

    return;
  }

  if (filteredAppliances.length === 0) {
    $("#applianceGrid").innerHTML =
      '<div class="appliance-empty-state appliance-no-results" role="status">' +
        '<div class="appliance-empty-icon" aria-hidden="true">⌕</div>' +
        '<span class="eyebrow">LET’S TRY ANOTHER SEARCH</span>' +
        "<h2>No appliances found</h2>" +
        "<p>" +
          "We couldn’t find any appliances with these filters. " +
          "Clear them to see your full list." +
        "</p>" +
        '<button class="button button-primary" id="resetApplianceFilters" type="button">' +
          "Clear filters" +
        "</button>" +
      "</div>";

    // Reset the search and category, then show the full appliance list.
    $("#resetApplianceFilters").addEventListener("click", () => {
      $("#applianceSearch").value = "";
      $("#categoryFilter").value = "all";
      renderAppliances();
    });

    return;
  }

  $("#applianceGrid").innerHTML = filteredAppliances
    .map(appliance => {
      return (
        '<article class="appliance-card" data-appliance-card="' +
          appliance.id +
        '">' +
          '<div class="appliance-card-top">' +
            iconFor(appliance) +
            '<div class="appliance-card-actions">' +
              '<span class="status-pill ' +
                statusClass(appliance.status) +
              '">' +
                appliance.status +
              "</span>" +
              '<button class="appliance-edit-button" type="button"' +
                ' data-edit-appliance="' + appliance.id + '"' +
                ' aria-label="Edit appliance"' +
                ' title="Edit appliance">Edit</button>' +
              '<button class="appliance-delete-button" type="button"' +
                ' data-delete-appliance="' + appliance.id + '"' +
                ' aria-label="Delete appliance"' +
                ' title="Delete appliance">Delete</button>' +
            "</div>" +
          "</div>" +
          "<h3>" + appliance.name + "</h3>" +
          '<span class="category">' +
            appliance.brand + " · " + appliance.category +
          "</span>" +
          '<div class="appliance-dates">' +
            "<div>" +
              "<span>Last maintenance</span>" +
              "<strong>" + appliance.last + "</strong>" +
            "</div>" +
            "<div>" +
              "<span>Next recommended</span>" +
              "<strong>" + appliance.next + "</strong>" +
            "</div>" +
            '<span class="appliance-arrow">→</span>' +
          "</div>" +
        "</article>"
      );
    })
    .join("");

  // Open the appliance detail page when a card is selected.
  $$("[data-appliance-card]").forEach(card => {
    card.addEventListener("click", () => {
      openAppliance(card.dataset.applianceCard);
    });
  });
  // Handle Edit button clicks without opening appliance details.
  $$("[data-edit-appliance]").forEach(button => {
    button.addEventListener("click", event => {
      event.stopPropagation();

      const applianceId = button.dataset.editAppliance;
      const appliance = appliances.find(
        item => String(item.id) === String(applianceId)
);

if (!appliance) {
  return;
}

applianceBeingEdited = appliance.id;

const form = $("#applianceForm");

form.elements["name"].value = appliance.name;
form.elements["type"].value = appliance.type;
form.elements["brand"].value = appliance.brand || "";
form.elements["model"].value = appliance.model || "";
form.elements["category"].value = appliance.category;
form.elements["purchase"].value = appliance.purchaseDate || "";
form.elements["last"].value = appliance.lastMaintenanceDate || "";

$("#applianceModalTitle").textContent = "Edit appliance";

openModal("applianceModal");
    });
  });
  // Open the confirmation modal without opening the appliance details.
  $$("[data-delete-appliance]").forEach(button => {
    button.addEventListener("click", event => {
      event.stopPropagation();
      openDeleteApplianceModal(button.dataset.deleteAppliance);
    });
  });
}

// Fill the appliance detail page and navigate to it.
// Find the selected appliance by its unique database ID.
function openAppliance(applianceId) {
  selectedAppliance = appliances.find(
    appliance => String(appliance.id) === String(applianceId)
  );

  if (!selectedAppliance) {
    return;
  }

  $("#deleteDetailApplianceButton").disabled = false;

  $("#detailName").textContent = selectedAppliance.name;
    const applianceDetails = [];

  if (selectedAppliance.brand) {
    applianceDetails.push(selectedAppliance.brand);
  }

  if (selectedAppliance.model) {
    applianceDetails.push(selectedAppliance.model);
  }

  if (selectedAppliance.purchase !== "Not provided") {
    applianceDetails.push("Purchased " + selectedAppliance.purchase);
  }

  $("#detailMeta").textContent = applianceDetails.join(" · ");

  $("#detailIcon").className =
    "appliance-large-icon " + selectedAppliance.tone;
  $("#detailIcon").textContent = selectedAppliance.icon;

  $("#detailLast").textContent = selectedAppliance.last;
  $("#detailNext").textContent = selectedAppliance.next;
  $("#detailStatus").textContent = selectedAppliance.status;
  $("#detailStatus").className =
    "status-pill " + statusClass(selectedAppliance.status);
  // Enable deletion after an appliance has been selected.
  $("#deleteDetailApplianceButton").disabled = false;
  navigate("appliance-details");
}

/* =========================================================
   Professionals
   ========================================================= */

// Draw the professional cards and attach profile and booking actions.
function renderProfessionals() {
  $("#professionalList").innerHTML = professionals
    .map((professional, index) => {
      const selectedClass = index === 0 ? " selected" : "";

      return (
        '<article class="pro-card' + selectedClass + '">' +
          '<div class="pro-top">' +
            '<div class="pro-logo">' + professional.logo + "</div>" +
            "<div>" +
              "<h3>" + professional.name + "</h3>" +
              '<div class="pro-rating">★ ' +
                professional.rating +
                "<span>" + professional.reviews + "</span>" +
              "</div>" +
            "</div>" +
          "</div>" +
          '<p class="pro-description">' +
            professional.description +
          "</p>" +
          '<div class="pro-meta">' +
            "<span>" + professional.category + "</span>" +
            "<span>" + professional.distance + "</span>" +
            "<span>" + professional.availability + "</span>" +
          "</div>" +
          '<div class="pro-actions">' +
            '<button class="outline-button" data-profile="' +
              professional.name +
            '">View profile</button>' +
            '<button class="soft-button" data-book="' +
              professional.name +
            '">Select time</button>' +
          "</div>" +
        "</article>"
      );
    })
    .join("");

  $$("[data-profile]").forEach(button => {
    button.addEventListener("click", () => {
      navigate("professional-profile");
    });
  });

  $$("[data-book]").forEach(button => {
    button.addEventListener("click", () => {
      navigate("professional-profile");

      setTimeout(() => {
        showToast(
          "Professional selected",
          "Choose an available appointment time."
        );
      }, 250);
    });
  });
}

/* =========================================================
   Maintenance Max chat
   ========================================================= */

// Add a user or assistant message to the chat window.
function addChatMessage(text, type) {
  let messageList = $("#chatMessageList");

  if (!messageList) {
    $("#chatWelcome")?.remove();

    messageList = document.createElement("div");
    messageList.id = "chatMessageList";
    messageList.className = "chat-message-list";

    $("#chatWindow").appendChild(messageList);
  }

  const row = document.createElement("div");
  row.className = "chat-message " + type;

  if (type === "max") {
    const avatar = document.createElement("span");
    avatar.className = "max-avatar";
    avatar.textContent = "✦";

    row.appendChild(avatar);
  }

  const bubble = document.createElement("div");
  bubble.className = "chat-bubble";
  bubble.textContent = text;

  // Preserve line breaks in AI responses.
  bubble.style.whiteSpace = "pre-wrap";

  row.appendChild(bubble);
  messageList.appendChild(row);

  $("#chatWindow").scrollTop =
    $("#chatWindow").scrollHeight;

  return row;
}

// Respond to the user's prompt with the app's current sample guidance.
// Conversation history for the current page session.
let maxConversation = [];
let savedMaxConversationId = null;
let maxConversationHasUnsavedChanges = false;

// Prevent overlapping AI requests.
let maxIsResponding = false;

async function askMax(text) {
  const message = text.trim();

  if (!message || maxIsResponding) {
    return;
  }

  maxIsResponding = true;

  const sendButton = $("#chatForm button");
  sendButton.disabled = true;

  addChatMessage(message, "user");

  const pendingMessage = addChatMessage(
    "Max is thinking...",
    "max"
  );

  const nextConversation = [
    ...maxConversation,
    {
      role: "user",
      content: message,
    },
  ].slice(-20);

  try {
    const { data, error } =
      await supabaseClient.functions.invoke(
        "maintenance-max",
        {
          body: {
            messages: nextConversation,
          },
        }
      );

    if (error) {
      throw error;
    }

    if (!data || typeof data.reply !== "string") {
      throw new Error("Invalid response from Max");
    }

    pendingMessage.querySelector(
      ".chat-bubble"
    ).textContent = data.reply;

    maxConversation = [
      ...nextConversation,
      {
        role: "assistant",
        content: data.reply,
      },
    ].slice(-20);

    maxConversationHasUnsavedChanges = true;

  } catch (error) {
    console.error("Maintenance Max error:", error);

    pendingMessage.querySelector(
      ".chat-bubble"
    ).textContent =
      "Sorry, I'm having trouble connecting right now. Please try again.";

  } finally {
    maxIsResponding = false;
    sendButton.disabled = false;
  }
}

/* =========================================================
   Shared click and browser-history events
   ========================================================= */

// Handle page links, modal close buttons, and backdrop clicks in one place.
document.addEventListener("click", event => {
  const pageTarget = event.target.closest("[data-page]");

  if (pageTarget) {
    event.preventDefault();
    navigate(pageTarget.dataset.page);
  }

  const closeButton = event.target.closest("[data-close]");

  if (closeButton) {
    closeModal(closeButton.dataset.close);
  }

  if (event.target.classList.contains("modal-backdrop")) {
    closeModal(event.target.id);
  }
});

async function loadSavedMaxConversations() {
  const container = document.getElementById(
    "savedMaxConversations"
  );

  const { data: { user }, error: userError } =
    await supabaseClient.auth.getUser();

  if (userError || !user) {
    container.textContent = "";
    return;
  }

  const { data, error } = await supabaseClient
    .from("max_conversations")
    .select("id, title, updated_at")
    .eq("user_id", user.id)
    .order("updated_at", { ascending: false });

  if (error) {
    console.error("Error loading conversations:", error);
    container.textContent = "Unable to load conversations.";
    return;
  }

  container.replaceChildren();

  if (data.length === 0) {
    container.textContent = "No saved conversations yet.";
    return;
  }

  data.forEach(conversation => {
    const row = document.createElement("div");
    row.className = "saved-max-row";

    const openButton = document.createElement("button");
    openButton.type = "button";
    openButton.className = "saved-max-open";
    openButton.textContent = conversation.title;

    openButton.addEventListener("click", () => {
      openSavedMaxConversation(conversation.id);
    });

    const renameButton = document.createElement("button");
    renameButton.type = "button";
    renameButton.className = "saved-max-rename";
    renameButton.textContent = "✏️";
renameButton.title = "Rename conversation";
renameButton.setAttribute("aria-label", "Rename conversation");

    renameButton.addEventListener("click", () => {
  renameSavedMaxConversation(
    conversation.id,
    conversation.title,
    row
  );
});
    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "saved-max-delete";
    deleteButton.textContent = "🗑️";
    deleteButton.title = "Delete conversation"; 
    deleteButton.setAttribute(
      "aria-label",
      `Delete ${conversation.title}`
    );

    deleteButton.addEventListener("click", () => {
      deleteSavedMaxConversation(conversation.id);
    });

    row.append(openButton, renameButton, deleteButton);
    container.appendChild(row);
  });
}

async function saveMaxConversation() {
  if (maxIsResponding) {
    alert("Please wait for Max to finish responding.");
    return;
  }

  if (maxConversation.length === 0) {
    alert("Start a conversation before saving.");
    return;
  }

  const { data: { user }, error: userError } =
    await supabaseClient.auth.getUser();

  if (userError || !user) {
    alert("Please sign in to save conversations.");
    return;
  }

  const firstUserMessage = maxConversation.find(
    message => message.role === "user"
  );

  const title = firstUserMessage
    ? firstUserMessage.content.slice(0, 60)
    : "Untitled conversation";

  const conversationData = {
    user_id: user.id,
    title,
    messages: maxConversation,
    updated_at: new Date().toISOString()
  };

  let result;

  if (savedMaxConversationId) {
    // Update an existing saved conversation.
    result = await supabaseClient
      .from("max_conversations")
      .update({
        messages: maxConversation,
        updated_at: conversationData.updated_at
      })
      .eq("id", savedMaxConversationId)
      .eq("user_id", user.id)
      .select("id")
      .single();
  } else {
    // Save a new conversation.
    result = await supabaseClient
      .from("max_conversations")
      .insert(conversationData)
      .select("id")
      .single();
  }

  if (result.error) {
    console.error("Error saving conversation:", result.error);
    alert("Unable to save conversation.");
    return;
  }

  savedMaxConversationId = result.data.id;
  maxConversationHasUnsavedChanges = false;

  await loadSavedMaxConversations();

  const saveButton = document.getElementById("saveMaxConversation");

  saveButton.textContent = "Saved ✓";

  setTimeout(() => {
    saveButton.textContent = "Save Conversation";
  }, 1500);
}

async function openSavedMaxConversation(conversationId) {
  if (maxIsResponding) {
    alert("Please wait for Max to finish responding.");
    return;
  }

  if (
    maxConversationHasUnsavedChanges &&
    !confirm("Discard changes to the current conversation?")
  ) {
    return;
  }

  const { data: { user }, error: userError } =
    await supabaseClient.auth.getUser();

  if (userError || !user) return;

  const { data, error } = await supabaseClient
    .from("max_conversations")
    .select("*")
    .eq("id", conversationId)
    .eq("user_id", user.id)
    .single();

  if (error) {
    console.error("Error opening conversation:", error);
    alert("Unable to open conversation.");
    return;
  }

  savedMaxConversationId = data.id;
  maxConversation = data.messages;
  maxConversationHasUnsavedChanges = false;

  clearMaxChat();

  maxConversation.forEach(message => {
    addChatMessage(
      message.content,
      message.role === "assistant" ? "max" : "user"
    );
  });
}

async function renameSavedMaxConversation(
  conversationId,
  currentTitle,
  row
) {
  const titleButton = row.querySelector(".saved-max-open");
  const renameButton = row.querySelector(".saved-max-rename");

  if (!titleButton || row.querySelector(".saved-max-input")) {
    return;
  }

  const input = document.createElement("input");
  input.type = "text";
  input.className = "saved-max-input";
  input.value = currentTitle;
  input.maxLength = 100;
  input.setAttribute("aria-label", "Conversation name");

  // Replace the title with an editable input.
  titleButton.replaceWith(input);

  input.focus();
  input.select();

  let finished = false;

  function restoreTitle(title) {
    input.replaceWith(titleButton);
    titleButton.textContent = title;
  }

  function cancelRename() {
    if (finished) return;

    finished = true;
    restoreTitle(currentTitle);
  }

  async function saveRename() {
    if (finished) return;

    const newTitle = input.value.trim();

    if (!newTitle) {
      input.focus();
      return;
    }

    if (newTitle === currentTitle) {
      cancelRename();
      return;
    }

    finished = true;
    input.disabled = true;
    renameButton.disabled = true;

    const { data: { user }, error: userError } =
      await supabaseClient.auth.getUser();

    if (userError || !user) {
      input.disabled = false;
      renameButton.disabled = false;
      finished = false;
      return;
    }

    const { error } = await supabaseClient
      .from("max_conversations")
      .update({
        title: newTitle,
        updated_at: new Date().toISOString()
      })
      .eq("id", conversationId)
      .eq("user_id", user.id);

    if (error) {
      console.error("Error renaming conversation:", error);

      input.disabled = false;
      renameButton.disabled = false;
      finished = false;
      return;
    }

    restoreTitle(newTitle);
    renameButton.disabled = false;

    await loadSavedMaxConversations();
  }

  input.addEventListener("keydown", event => {
    if (event.key === "Enter") {
      event.preventDefault();
      saveRename();
    }

    if (event.key === "Escape") {
      cancelRename();
    }
  });

  // Clicking outside the input saves the name.
  input.addEventListener("blur", () => {
    if (!finished) {
      saveRename();
    }
  });
}

async function deleteSavedMaxConversation(conversationId) {
  const confirmed = confirm(
    "Permanently delete this saved conversation?"
  );

  if (!confirmed) return;

  const { data: { user }, error: userError } =
    await supabaseClient.auth.getUser();

  if (userError || !user) return;

  const { error } = await supabaseClient
    .from("max_conversations")
    .delete()
    .eq("id", conversationId)
    .eq("user_id", user.id);

  if (error) {
    console.error("Error deleting conversation:", error);
    alert("Unable to delete conversation.");
    return;
  }

  if (savedMaxConversationId === conversationId) {
    savedMaxConversationId = null;
    maxConversation = [];
    maxConversationHasUnsavedChanges = false;
    clearMaxChat();
  }

  await loadSavedMaxConversations();
}

function clearMaxChat() {
  const chatWindow = document.getElementById("chatWindow");

  if (!chatWindow) return;

  chatWindow.replaceChildren();

  const messageList = document.createElement("div");
  messageList.id = "chatMessageList";
  messageList.className = "chat-message-list";

  chatWindow.appendChild(messageList);
}

document.getElementById("saveMaxConversation")
  .addEventListener("click", saveMaxConversation);

document.getElementById("newMaxConversation")
  .addEventListener("click", () => {
    if (maxIsResponding) {
      alert("Please wait for Max to finish responding.");
      return;
    }

    if (
      maxConversationHasUnsavedChanges &&
      !confirm("Discard your unsaved conversation changes?")
    ) {
      return;
    }

    savedMaxConversationId = null;
    maxConversation = [];
    maxConversationHasUnsavedChanges = false;

    clearMaxChat();
  });

// Keep the visible page in sync when the browser Back or Forward button is used.
window.addEventListener("popstate", () => {
  navigate(location.hash.slice(1) || "home", false);
});

/* =========================================================
   Main page controls
   ========================================================= */

$("#deleteDetailApplianceButton").addEventListener("click", () => {
  if (selectedAppliance) {
    removeAppliance(selectedAppliance.id);
  }
});
// Mobile sidebar and modal buttons.
$("#menuButton").addEventListener("click", () => {
  $("#sidebar").classList.toggle("open");
});

$("#openEventModal").addEventListener("click", () => {
  populateEventAppliances();
  openModal("eventModal");
});

$("#floatingAdd").addEventListener("click", () => {
  populateEventAppliances();
  openModal("eventModal");
});

$("#openApplianceModal").addEventListener("click", () => {
  applianceBeingEdited = null;
  $("#applianceForm").reset();
  $("#applianceModalTitle").textContent = "Add appliance";
  openModal("applianceModal");
});


$("#viewMaintenanceHistoryButton").addEventListener("click", () => {
  maintenanceApplianceFilter = selectedAppliance?.id || null;

  navigate("maintenance");

  $("#calendarView").classList.add("hidden");
  $("#listView").classList.remove("hidden");

  $$(".segment").forEach(button => {
    button.classList.toggle("active", button.dataset.view === "list");
  });

  renderEvents();
});


// Open the same confirmation modal from the details page.
$("#deleteDetailApplianceButton").addEventListener("click", () => {
  if (selectedAppliance) {
    openDeleteApplianceModal(selectedAppliance.id);
  }
});

// Delete only after the user confirms in the modal.
$("#confirmDeleteApplianceButton").addEventListener(
  "click",
  async () => {
    if (!appliancePendingDelete) {
      return;
    }

    const button = $("#confirmDeleteApplianceButton");
    button.disabled = true;
    button.textContent = "Deleting...";

    try {
      const wasDeleted = await removeAppliance(
        appliancePendingDelete.id
      );

      if (wasDeleted) {
        closeModal("deleteApplianceModal");
        appliancePendingDelete = null;
      }
    } finally {
      button.disabled = false;
      button.textContent = "Delete appliance";
    }
  }
);

// Switch between the calendar and list views on the Maintenance page.
$$(".segment").forEach(button => {
  button.addEventListener("click", () => {
    $$(".segment").forEach(segment => {
      segment.classList.remove("active");
    });

    button.classList.add("active");

    $("#calendarView").classList.toggle(
      "hidden",
      button.dataset.view !== "calendar"
    );

    $("#listView").classList.toggle(
      "hidden",
      button.dataset.view !== "list"
    );
  });
});

// Save a new maintenance event in the current browser session.
$("#eventForm").addEventListener("submit", event => {
  event.preventDefault();

  const formData = new FormData(event.target);
  const timeValue = formData.get("time") || "09:00";
  const displayTime = new Date("2026-01-01T" + timeValue)
    .toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit"
    });

  events.push({
    name: formData.get("name"),
    category: formData.get("category"),
    applianceId: formData.get("applianceId") || null,
    date: formData.get("date"),
    time: displayTime,
    description:
      formData.get("description") ||
      "A new home maintenance reminder.",
    status: "Upcoming"
  });

  event.target.reset();
  closeModal("eventModal");
  renderCalendar();
  renderEvents();

  showToast(
    "Event added",
    "Your maintenance reminder is on the calendar."
  );
});

/* =========================================================
   Appliance form
   ========================================================= */

// Save a new appliance to Supabase, then display the returned record.
$("#applianceForm").addEventListener("submit", async event => {
  event.preventDefault();

  const formData = new FormData(event.target);

  // These keys must match the column names in the Supabase table.
  const applianceToInsert = {
    name: formData.get("name"),
    type: formData.get("type"),
    brand: formData.get("brand") || null,
    model: formData.get("model") || null,
    category: formData.get("category"),
    purchase_date: formData.get("purchase") || null,
    last_maintenance_date: formData.get("last") || null
  };

  let query = supabaseClient.from("appliances");

if (applianceBeingEdited !== null) {
  query = query
    .update(applianceToInsert)
    .eq("appliance_id", applianceBeingEdited);
} else {
  query = query.insert(applianceToInsert);
}

const {
  data: savedAppliance,
  error
} = await query
  .select()
  .single();

  if (error) {
    console.error("Appliance save error:", error);

    showToast(
      "Error",
      "The appliance could not be saved."
    );

    return;
  }

  // Match the database record to the format used by appliance cards.
  const applianceForUI = {
    id: savedAppliance.appliance_id,
    name: savedAppliance.name,
    type: savedAppliance.type,
    brand: savedAppliance.brand || "Unknown brand",
    model: savedAppliance.model || "Model not added",
    category: savedAppliance.category,
    purchaseDate: savedAppliance.purchase_date || "",
    lastMaintenanceDate: savedAppliance.last_maintenance_date || "",

    last: savedAppliance.last_maintenance_date
      ? formatDate(savedAppliance.last_maintenance_date).full
      : "Not yet serviced",

    next: "Not scheduled",
    status: "Not recorded",
    icon: "▤",
    tone: "",

      purchase: savedAppliance.purchase_date
    ? formatDate(savedAppliance.purchase_date).full
    : "Not provided"
  };

  // Add the new record to the beginning of the visible appliance list.
  if (applianceBeingEdited !== null) {
  const index = appliances.findIndex(
    appliance => String(appliance.id) === String(applianceBeingEdited)
  );

  if (index !== -1) {
    appliances[index] = applianceForUI;
  }
} else {
  appliances.unshift(applianceForUI);
}

  const wasEditing = applianceBeingEdited !== null;

applianceBeingEdited = null;

renderAppliances();
event.target.reset();
$("#applianceModalTitle").textContent = "Add appliance";
closeModal("applianceModal");

  showToast(
  wasEditing ? "Appliance updated" : "Appliance added",
  wasEditing
    ? "Your appliance was updated successfully."
    : "Your appliance was saved successfully."
);
});

// Update the appliance list as the user searches or changes category.
$("#applianceSearch").addEventListener("input", renderAppliances);
$("#categoryFilter").addEventListener("change", renderAppliances);

/* =========================================================
   Assistant and professional page controls
   ========================================================= */

// Open Maintenance Max from an appliance detail page.
$("#askMaxButton").addEventListener("click", () => {
  navigate("assistant");

  setTimeout(() => {
    if (selectedAppliance) {
      askMax("I have a question about my " + selectedAppliance.name + ".");
    }
  }, 100);
});

// Handle the suggested Maintenance Max prompts.
$$("[data-prompt]").forEach(button => {
  button.addEventListener("click", () => {
    const prompt = button.dataset.prompt;
    askMax(prompt);
  });
});

// Ask Max about the appliance selected in the context panel.
$$("[data-appliance]").forEach(button => {
  button.addEventListener("click", () => {
    askMax("I have a question about my " + button.dataset.appliance + ".");
  });
});

// Send a message typed into the chat input.
$("#chatForm").addEventListener("submit", event => {
  event.preventDefault();

  const input = $("#chatInput");
  const message = input.value.trim();

  if (message) {
    askMax(message);
    input.value = "";
  }
});

// Select a professional category.
$$(".category-chip").forEach(button => {
  button.addEventListener("click", () => {
    $$(".category-chip").forEach(chip => {
      chip.classList.remove("active");
    });

    button.classList.add("active");
  });
});

$("#findProfessionals").addEventListener("click", () => {
  renderProfessionals();
  showToast("Search updated", "Showing trusted professionals near you.");
});

$("#bookService").addEventListener("click", () => {
  navigate("professional-profile");
  showToast("Ready to book", "Choose a date and time below.");
});

// Select an available appointment date and time.
$$(".date-option").forEach(button => {
  button.addEventListener("click", () => {
    $$(".date-option").forEach(option => {
      option.classList.remove("active");
    });

    button.classList.add("active");
  });
});

$$(".time-options button").forEach(button => {
  button.addEventListener("click", () => {
    $$(".time-options button").forEach(option => {
      option.classList.remove("selected");
    });

    button.classList.add("selected");
  });
});

$("#selectTime").addEventListener("click", () => {
  showToast(
    "Appointment selected",
    "Evergreen Home Services will confirm shortly."
  );
});

// Update the selected star rating.
$$("#starInput button").forEach((button, selectedIndex) => {
  button.addEventListener("click", () => {
    $$("#starInput button").forEach((star, starIndex) => {
      star.classList.toggle("selected", starIndex <= selectedIndex);
    });
  });
});

$("#submitReview").addEventListener("click", () => {
  showToast("Review submitted", "Thanks for sharing your experience.");
});

/* =========================================================
   Initial page rendering
   ========================================================= */

// Restore the page represented by the current URL hash.
navigate(location.hash.slice(1) || "home", false);

// Draw the sample data shown before a page is opened.
renderCalendar();
renderEvents();
renderMiniEvents();
renderProfessionals();

/* =========================================================
   Account settings
   ========================================================= */

// Store the authenticated Supabase user for account changes.
let currentAccountUser = null;

// Retrieve the current user and refresh their name in the interface.
async function loadAccount() {
  const { data, error } = await supabaseClient.auth.getUser();

  if (error || !data.user) {
    console.error("Unable to load account:", error);
    return;
  }

  currentAccountUser = data.user;
  updateAccountDisplay();
}

// Update the name and profile initials throughout the app.
function updateAccountDisplay() {
  if (!currentAccountUser) {
    return;
  }

  const firstName =
    currentAccountUser.user_metadata?.first_name || "";
  const displayName = firstName || "Your Name";
  const greetingName = firstName || "there";

  $("#sidebarUsername").textContent = displayName;
  $("#homeUsername").textContent = greetingName;

  const maxUsername = $("#maxUsername");

  if (maxUsername) {
    maxUsername.textContent = greetingName;
  }

  const initial = firstName
    ? firstName.charAt(0).toUpperCase()
    : "?";

  $(".avatar-small").textContent = initial;
  $(".top-avatar").textContent = initial;
}

// Load saved account information into the settings form.
$("#accountSettingsButton").addEventListener("click", async () => {
  await loadAccount();

  if (!currentAccountUser) {
    showToast("Error", "Please sign in again.");
    return;
  }

  $("#accountFirstName").value =
    currentAccountUser.user_metadata?.first_name || "";

  $("#accountEmail").value = currentAccountUser.email || "";

  $("#accountZip").value =
    currentAccountUser.user_metadata?.zip_code || "";

  // Passwords are never read back from the service.
  $("#accountPassword").value = "";
  $("#accountConfirmPassword").value = "";

  openModal("accountModal");
});

// Open Account Settings when the top-right profile icon is clicked.
$("#topAccountButton").addEventListener("click", () => {
  $("#accountSettingsButton").click();
});

// Save profile details and any optional password change.
$("#accountForm").addEventListener("submit", async event => {
  event.preventDefault();

  if (!currentAccountUser) {
    showToast("Error", "Please sign in again.");
    return;
  }

  const firstName = $("#accountFirstName").value.trim();
  const email = $("#accountEmail").value.trim();
  const zipCode = $("#accountZip").value.trim();
  const password = $("#accountPassword").value;
  const confirmPassword = $("#accountConfirmPassword").value;


 if (zipCode && !/^[0-9]{5}$/.test(zipCode)) {
  showToast("Invalid ZIP Code", "Enter a five-digit ZIP code.");
  return;
}

  if (password !== confirmPassword) {
    showToast("Password Error", "Passwords do not match.");
    return;
  }

  if (password && password.length < 8) {
    showToast("Password Error", "Use at least eight characters.");
    return;
  }

  const saveButton = event.target.querySelector(
    'button[type="submit"]'
  );

  saveButton.disabled = true;
  saveButton.textContent = "Saving...";

  try {
    // Update the first name and ZIP code in user metadata.
    const { error: profileError } =
      await supabaseClient.auth.updateUser({
        data: {
          first_name: firstName,
          zip_code: zipCode
        }
      });

    if (profileError) {
      throw profileError;
    }

    // Request an email change only when the address is different.
    const emailChanged = email !== currentAccountUser.email;

    if (emailChanged) {
      const { error: emailError } =
        await supabaseClient.auth.updateUser({ email });

      if (emailError) {
        throw emailError;
      }
    }

    // Change the password only when a new one was entered.
    if (password) {
      const { error: passwordError } =
        await supabaseClient.auth.updateUser({ password });

      if (passwordError) {
        throw passwordError;
      }
    }

    await loadAccount();

    $("#accountPassword").value = "";
    $("#accountConfirmPassword").value = "";
    closeModal("accountModal");

    if (emailChanged) {
      showToast(
        "Account Updated",
        "Check your email for any required confirmation."
      );
    } else {
      showToast(
        "Account Updated",
        "Your account information has been saved."
      );
    }
  } catch (error) {
    console.error("Account update error:", error);

    showToast(
      "Update Error",
      error.message || "Unable to update account."
    );

    // Refresh the user because an earlier profile update may have worked.
    await loadAccount();
  } finally {
    saveButton.disabled = false;
    saveButton.textContent = "Save Changes";
  }
});

/* =========================================================
   Account deletion
   ========================================================= */

const deleteAccountButton = $("#deleteAccountButton");
const deleteConfirmationInput = $("#deleteConfirmationInput");
const confirmDeleteButton = $("#confirmDeleteAccountButton");

// Show the confirmation modal before starting account deletion.
deleteAccountButton.addEventListener("click", () => {
  deleteConfirmationInput.value = "";
  confirmDeleteButton.disabled = true;

  closeModal("accountModal");
  openModal("deleteAccountModal");
  deleteConfirmationInput.focus();
});

// Require the user to type DELETE before enabling the final button.
deleteConfirmationInput.addEventListener("input", () => {
  confirmDeleteButton.disabled =
    deleteConfirmationInput.value !== "DELETE";
});

// Call the Supabase Edge Function that removes the signed-in account.
confirmDeleteButton.addEventListener("click", async () => {
  if (deleteConfirmationInput.value !== "DELETE") {
    return;
  }

  confirmDeleteButton.disabled = true;
  confirmDeleteButton.textContent = "Deleting...";

  try {
    const {
      data: sessionData,
      error: sessionError
    } = await supabaseClient.auth.getSession();

    if (sessionError || !sessionData.session) {
      throw new Error("Please sign in again.");
    }

    const { data, error } = await supabaseClient.functions.invoke(
      "delete-account",
      {
        headers: {
          Authorization:
            "Bearer " + sessionData.session.access_token
        }
      }
    );

    if (error) {
      throw error;
    }

    if (!data?.success) {
      throw new Error(data?.error || "Account deletion failed.");
    }

    // Clear the local session and return to the sign-in page.
    await supabaseClient.auth.signOut({ scope: "local" });

    closeModal("deleteAccountModal");
    currentAccountUser = null;

    appShell.style.display = "none";
    loginPage.style.display = "flex";
    loginForm.reset();

    showToast("Account Deleted", "Your account has been deleted.");
  } catch (error) {
    console.error("Account deletion error:", error);

    showToast(
      "Deletion Failed",
      error.message || "Please try again."
    );
  } finally {
    confirmDeleteButton.disabled = false;
    confirmDeleteButton.textContent = "Permanently Delete Account";
  }
});

/* =========================================================
   Sign-in, sign-up, and session restoration
   ========================================================= */

const loginForm = $("#loginForm");
const loginPage = $("#loginPage");
const appShell = $(".app-shell");
const loginMessage = $("#loginMessage");
const signupForm = $("#signupForm");
const showSignupButton = $("#showSignupButton");
const backToLoginButton = $("#backToLoginButton");
const signOutButton = $("#signOutButton");

// Reveal the app after authentication and load the user's data.
async function showMainApp() {
  loginPage.style.display = "none";
  appShell.style.display = "flex";
  loadSavedMaxConversations();
  await loadAccount();
  await loadAppliances();
}

// Sign in with the email and password entered by the user.
loginForm.addEventListener("submit", async event => {
  event.preventDefault();

  const email = $("#loginEmail").value.trim();
  const password = $("#loginPassword").value;

  loginMessage.textContent = "Signing in...";

  const { data, error } =
    await supabaseClient.auth.signInWithPassword({
      email,
      password
    });

  if (error) {
    loginMessage.textContent = error.message;
    return;
  }

  if (data.user) {
    loginMessage.textContent = "";
    showMainApp();
  }
});

// Switch from sign-in to sign-up view.
showSignupButton.addEventListener("click", () => {
  loginForm.style.display = "none";
  signupForm.style.display = "flex";
  showSignupButton.parentElement.style.display = "none";
  loginMessage.style.display = "none";
});

// Return from sign-up to sign-in view.
backToLoginButton.addEventListener("click", () => {
  signupForm.style.display = "none";
  loginForm.style.display = "flex";
  showSignupButton.parentElement.style.display = "";
  loginMessage.style.display = "";
});

// Create an account in Supabase.
signupForm.addEventListener("submit", async event => {
  event.preventDefault();

  const email = $("#signupEmail").value.trim();
  const password = $("#signupPassword").value;
  const firstName = $("#signupFirstName").value.trim();
  const zipCode = $("#signupZip").value.trim();
  const signupMessage = $("#signupMessage");

  signupMessage.textContent = "Creating your account...";

  const { data, error } = await supabaseClient.auth.signUp({
  email,
  password,
  options: {
    data: {
      first_name: firstName,
      zip_code: zipCode
    }
  }
});

  if (error) {
    signupMessage.textContent = error.message;
    return;
  }

  if (data.session) {
    signupMessage.textContent = "";
    showMainApp();
  } else {
    signupMessage.textContent =
      "Account created! Please check your email to confirm your " +
      "account, then sign in.";
  }
});

// Restore an existing Supabase session after a page refresh.
async function checkLoginSession() {
  const { data, error } = await supabaseClient.auth.getSession();

  if (error) {
    console.error("Session error:", error.message);
    return;
  }

  if (data.session) {
    showMainApp();
  }
}

// Check for an existing session when the page first loads.
checkLoginSession();

// Sign out and clear the previous user's information from the page.
signOutButton.addEventListener("click", async () => {
  const { error } = await supabaseClient.auth.signOut();

  if (error) {
    alert("Sign out failed: " + error.message);
    return;
  }

  currentAccountUser = null;
  appliances = [];
  appliancesLoading = true;

  // Reset the account information displayed in the interface.
  $("#sidebarUsername").textContent = "Your Name";
  $("#homeUsername").textContent = "there";

  const maxUsername = $("#maxUsername");

  if (maxUsername) {
    maxUsername.textContent = "there";
  }

  $(".avatar-small").textContent = "?";
  $(".top-avatar").textContent = "?";

  appShell.style.display = "none";
  loginPage.style.display = "flex";
  loginForm.reset();
});
