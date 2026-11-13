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
let maintenanceEventBeingEdited = null;
let maintenanceEventSeriesBeingEdited = null;
let selectedMaintenanceEvent = null;
let pendingRecurringDeletion = null;
let maintenanceApplianceFilter = null;
let maintenanceHistoryFromAppliance = false;
// Stores the appliance while its deletion is awaiting confirmation.
let appliancePendingDelete = null;

// Maintenance events are loaded from Supabase.
let events = [];
let eventsLoading = false;

// Currently displayed calendar month.
let calendarMonth = new Date(
  new Date().getFullYear(),
  new Date().getMonth(),
  1
);

// Appliance records are loaded from Supabase after sign-in.
// Start in the loading state so the page does not briefly show
// the first-time empty screen while the database request is pending.
let appliances = [];
let appliancesLoading = true;

// Sample professional listings used by the Professionals page.
// Professionals come from the find-pros Edge Function (Google Places).
let proResults = [];       // places from the latest search
let proSearchLabel = "";   // e.g. "Professionals near 84604"
let proSearching = false;
let currentPlace = null;   // the profile being viewed
let selectedStars = 0;

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

function getLocalDateString(date = new Date()) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
  ].join("-");
}

function formatMaintenanceTime(timeValue) {
  if (!timeValue) {
    return "";
  }

  const [hours, minutes] = timeValue.split(":").map(Number);
  return new Date(2000, 0, 1, hours, minutes).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit"
  });
}

function getRecurringDates(startDate, repeat, endDate = null) {
  if (repeat === "none") {
    return [startDate];
  }

  if (endDate && endDate < startDate) {
    return [];
  }

  const start = new Date(startDate + "T12:00:00");
  const dates = [];

  for (let i = 0; endDate || i < 12; i += 1) {
    const recurringDate = new Date(start);

    if (repeat === "weekly") {
      recurringDate.setDate(start.getDate() + (i * 7));
    } else if (repeat === "monthly") {
      recurringDate.setMonth(start.getMonth() + i);
    } else if (repeat === "yearly") {
      recurringDate.setFullYear(start.getFullYear() + i);
    }

    const date = getLocalDateString(recurringDate);
    if (endDate && date > endDate) {
      break;
    }

    dates.push(date);
  }

  return dates;
}

function updateEventRepeatUntil() {
  const form = $("#eventForm");
  const repeat = form.elements["repeat"].value;
  const repeatUntilField = $("#eventRepeatUntilField");
  const repeatUntilInput = form.elements["repeatUntil"];
  const isRepeating = repeat !== "none";
  const isEditingRecurringSeries =
    Boolean(maintenanceEventSeriesBeingEdited);

  repeatUntilField.hidden = !isRepeating || isEditingRecurringSeries;
  repeatUntilInput.required = isRepeating && !isEditingRecurringSeries;
  repeatUntilInput.min = form.elements["date"].value;

  if (isEditingRecurringSeries) {
    return;
  }

  if (!isRepeating) {
    repeatUntilInput.value = "";
    repeatUntilInput.dataset.custom = "false";
    return;
  }

  if (
    !repeatUntilInput.dataset.custom ||
    repeatUntilInput.value < form.elements["date"].value
  ) {
    const defaultDates = getRecurringDates(
      form.elements["date"].value,
      repeat
    );
    repeatUntilInput.value = defaultDates[defaultDates.length - 1];
    repeatUntilInput.dataset.custom = "false";
  }
}

function getRecurringSeriesEvents(maintenanceEvent) {
  const matchingEvents = events.filter(event =>
    event.name === maintenanceEvent.name &&
    event.category === maintenanceEvent.category &&
    event.applianceId === maintenanceEvent.applianceId &&
    event.timeValue === maintenanceEvent.timeValue &&
    event.description === maintenanceEvent.description
  );
  let recurringSeries = [maintenanceEvent];
  const latestMatchingDate = matchingEvents.reduce(
    (latestDate, event) =>
      event.date > latestDate ? event.date : latestDate,
    maintenanceEvent.date
  );

  ["weekly", "monthly", "yearly"].forEach(repeat => {
    matchingEvents.forEach(startEvent => {
      const recurringDates = new Set(
        getRecurringDates(startEvent.date, repeat, latestMatchingDate)
      );
      if (!recurringDates.has(maintenanceEvent.date)) {
        return;
      }

      const series = matchingEvents.filter(event =>
        recurringDates.has(event.date)
      );
      if (
        series.some(event => event.id === maintenanceEvent.id) &&
        series.length > recurringSeries.length
      ) {
        recurringSeries = series;
      }
    });
  });

  return recurringSeries;
}

function getRecurringSeriesFrequency(series) {
  const orderedSeries = [...series].sort((first, second) =>
    first.date.localeCompare(second.date)
  );
  if (orderedSeries.length < 2) {
    return null;
  }

  const firstDate = orderedSeries[0].date;
  const lastDate = orderedSeries[orderedSeries.length - 1].date;

  for (const repeat of ["weekly", "monthly", "yearly"]) {
    const dates = getRecurringDates(firstDate, repeat, lastDate);
    if (
      dates.length === orderedSeries.length &&
      dates.every((date, index) => date === orderedSeries[index].date)
    ) {
      return repeat;
    }
  }

  for (const repeat of ["yearly", "monthly", "weekly"]) {
    const dates = new Set(getRecurringDates(firstDate, repeat, lastDate));
    if (orderedSeries.every(event => dates.has(event.date))) {
      return repeat;
    }
  }

  return null;
}

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
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

function maintenanceEventStatus(event) {
  if (event.status === "Completed") {
    return "Completed";
  }

  const today = getLocalDateString();
  if (event.date > today) {
    return "Upcoming";
  }
  if (event.date < today) {
    return "Not completed";
  }
  if (!event.timeValue) {
    return "Upcoming";
  }

  const scheduledAt = new Date(event.date + "T" + event.timeValue);
  return scheduledAt >= new Date() ? "Upcoming" : "Not completed";
}

/* =========================================================
   Page navigation
   ========================================================= */




// Switch the visible page and keep the URL hash in sync.

function navigate(page, updateHistory = true) {
  // A profile can't be shown after a refresh, because it needs a selected business.
  if (page === "professional-profile" && !currentPlace) {
    page = "professionals";
  }

  if (page !== "maintenance") {
    maintenanceHistoryFromAppliance = false;
  }

  if (!pages.includes(page)) {
    page = "home";
  }

  $("#backToApplianceHistoryButton").classList.toggle(
    "hidden",
    page !== "maintenance" || !maintenanceHistoryFromAppliance
  );

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

   async function loadMaintenanceEvents() {
  eventsLoading = true;

  try {
    const { data: userData, error: userError } =
      await supabaseClient.auth.getUser();

    if (userError || !userData.user) {
      throw userError || new Error("Not signed in.");
    }

    const { data, error } = await supabaseClient
      .from("maintenance_events")
      .select("*")
      .eq("user_id", userData.user.id)
      .order("event_date", { ascending: true });

    if (error) throw error;

    events = (data || []).map(item => ({
      id: item.id,
      name: item.name,
      category: item.category,
      applianceId: item.appliance_id,
      date: item.event_date,
      time: formatMaintenanceTime(item.event_time),
      timeValue: item.event_time || "",
      description: item.description || "",
      status: item.status
    }));

    $("#homeDate").textContent = new Date().toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric"
    }).toUpperCase();

    renderCalendar();
    renderEvents();
    renderMiniEvents();
    if (selectedAppliance) {
      renderApplianceHistory(selectedAppliance);
    }

  } catch (error) {
    console.error("Error loading maintenance events:", error);

    showToast(
      "Error",
      error.message || "Unable to load maintenance events."
    );
  } finally {
    eventsLoading = false;
  }
}

// Show the three nearest incomplete events on the home page.
function renderMiniEvents() {
  const homeEvents = events
    .filter(event => maintenanceEventStatus(event) === "Upcoming")
    .sort((first, second) =>
      (first.date + "T" + (first.timeValue || "23:59")).localeCompare(
        second.date + "T" + (second.timeValue || "23:59")
      )
    )
    .slice(0, 3);

  $("#miniEventList").innerHTML = homeEvents
    .map(event => {
      const date = formatDate(event.date);
      const eventIndex = events.indexOf(event);
      const status = maintenanceEventStatus(event);
      const isCompleted = event.status === "Completed";

      return (
        '<div class="mini-event" data-home-event="' + eventIndex + '">' +
          '<div class="event-date">' +
            "<span>" + date.month + "</span>" +
            "<b>" + date.day + "</b>" +
          "</div>" +
          '<div class="mini-event-info">' +
            '<strong class="home-event-name' +
              (isCompleted ? " completed" : "") + '">' +
              escapeHTML(event.name) + "</strong>" +
            "<span>" + escapeHTML(event.time || "Time not set") + " · " +
              escapeHTML(event.category) + "</span>" +
          "</div>" +
          '<span class="event-category' +
            (isCompleted ? " completed" : "") + '">' +
            escapeHTML(status) + "</span>" +
          '<button class="event-complete home-event-complete"' +
            ' data-home-complete="' + eventIndex + '"' +
            ' aria-label="' +
              (isCompleted ? "Mark not complete" : "Mark complete") + '"' +
            ' title="' +
              (isCompleted ? "Mark not complete" : "Mark complete") + '"' +
            ' aria-pressed="' + isCompleted + '">' +
            "✓</button>" +
        "</div>"
      );
    })
    .join("") || '<p class="maintenance-empty">No maintenance events yet.</p>';
}

function populateEventAppliances() {
  const select = $("#eventAppliance");
  const selectedValue = select.value;

  select.innerHTML =
    '<option value="">No appliance</option>' +
    appliances.map(appliance =>
      '<option value="' + escapeHTML(appliance.id) + '">' +
        escapeHTML(appliance.name) +
      '</option>'
    ).join("");

  select.value = selectedValue;
}

function renderApplianceHistory(appliance) {
  const historyEntries = events
    .filter(event => String(event.applianceId) === String(appliance.id))
    .map(event => ({
      date: event.date,
      title: event.name,
      status: maintenanceEventStatus(event)
    }));

  if (appliance.purchaseDate) {
    historyEntries.push({
      date: appliance.purchaseDate,
      title: "Purchase date"
    });
  }

  if (appliance.lastMaintenanceDate) {
    historyEntries.push({
      date: appliance.lastMaintenanceDate,
      title: "Last maintenance"
    });
  }

  historyEntries.sort((first, second) => first.date.localeCompare(second.date));

  $("#detailHistory").innerHTML = historyEntries
    .map(entry =>
      '<article class="appliance-history-item">' +
        "<strong>" + escapeHTML(entry.title) + "</strong>" +
        "<span>" + escapeHTML(formatDate(entry.date).full) +
          (entry.status ? " · " + escapeHTML(entry.status) : "") + "</span>" +
      "</article>"
    )
    .join("") ||
    '<p class="maintenance-empty">No maintenance history for this appliance yet.</p>';
}

// Draw the selected month and place maintenance events on their dates.
function showCalendarEventDetails(eventIndex) {
  const selectedEvent = events[eventIndex];
  if (!selectedEvent) return;
  selectedMaintenanceEvent = selectedEvent;

  document.getElementById("detailsEventName").textContent =
    selectedEvent.name;
  const eventDescription = selectedEvent.description.trim();
  document.getElementById("detailsEventDescription").textContent =
    eventDescription;
  document.getElementById("eventDescriptionContainer").hidden =
    !eventDescription;
  document.getElementById("detailsEventDate").textContent =
    selectedEvent.date;
  document.getElementById("detailsEventTime").textContent =
    selectedEvent.time || "Not specified";

  const linkedAppliance = appliances.find(
    appliance => String(appliance.id) === String(selectedEvent.applianceId)
  );
  document.getElementById("detailsEventAppliance").textContent =
    linkedAppliance ? linkedAppliance.name : "No appliance";

  const status = document.getElementById("detailsEventStatus");
  status.textContent = maintenanceEventStatus(selectedEvent);
  status.className =
    selectedEvent.status === "Completed"
      ? "details-status-completed"
      : "details-status-upcoming";
  const completionButton = $("#toggleEventCompletionButton");
  const isCompleted = selectedEvent.status === "Completed";
  completionButton.textContent =
    isCompleted ? "Mark not complete" : "Mark complete";
  completionButton.className =
    "event-details-edit event-details-completion " +
    (isCompleted ? "mark-not-complete" : "mark-complete");
  completionButton.setAttribute("aria-pressed", String(isCompleted));

  document.getElementById("calendarDayModal").hidden = true;
  document.getElementById("eventDetailsModal").hidden = false;
}

function showCalendarDayEvents(date) {
  const dayEvents = events.filter(event => event.date === date);
  const formattedDate = new Date(date + "T12:00:00").toLocaleDateString(
    "en-US",
    { weekday: "long", month: "long", day: "numeric", year: "numeric" }
  );

  $("#calendarDayTitle").textContent = formattedDate;
  $("#calendarDayEvents").innerHTML = dayEvents
    .map((event, index) => {
      const eventIndex = events.indexOf(event);
      let eventColor = "";
      if (index % 3 === 1) eventColor = " peach-event";
      if (index % 3 === 2) eventColor = " purple-event";

      return (
        '<button type="button" class="calendar-event' + eventColor +
        (event.status === "Completed" ? " completed" : "") + '"' +
        ' data-calendar-event="' + eventIndex + '">' +
        escapeHTML(event.name) +
        "</button>"
      );
    })
    .join("");
  $("#calendarDayModal").hidden = false;
}

function renderCalendar() {
  const daysOfWeek = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const year = calendarMonth.getFullYear();
  const month = calendarMonth.getMonth();
  const firstDayOfMonth = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = new Date();
  const monthEvents = events.filter(event => {
    const eventDate = new Date(event.date + "T12:00:00");
    return eventDate.getFullYear() === year &&
      eventDate.getMonth() === month;
  });

  const cells = daysOfWeek.map(day =>
    '<div class="calendar-day-name">' + day + "</div>"
  );

  // Add blank cells before the first day of the month.
  for (let index = 0; index < firstDayOfMonth; index += 1) {
    cells.push('<div class="calendar-cell muted-day"></div>');
  }

  // Add one calendar cell for each day, including that day's events.
  for (let day = 1; day <= daysInMonth; day += 1) {
    const isoDate = year + "-" +
      String(month + 1).padStart(2, "0") + "-" +
      String(day).padStart(2, "0");
    const dayEvents = monthEvents.filter(event => event.date === isoDate);
    const isToday = today.getFullYear() === year &&
      today.getMonth() === month &&
      today.getDate() === day;

    const eventMarkup = dayEvents
  .slice(0, 1)
  .map((event, index) => {
    let eventColor = "";

    if (index % 3 === 1) {
      eventColor = " peach-event";
    } else if (index % 3 === 2) {
      eventColor = " purple-event";
    }

    const eventIndex = events.indexOf(event);

    return (
      '<button type="button" class="calendar-event' + eventColor +
      (event.status === "Completed" ? " completed" : "") + '"' +
        ' data-calendar-event="' + eventIndex + '"' +
        ' title="View event details">' +
        escapeHTML(event.name) +
      "</button>"
    );
  })
  .join("");
    const moreEventsMarkup = dayEvents.length > 1
      ? '<button type="button" class="calendar-more" ' +
        'data-calendar-more="' + isoDate + '" aria-label="Show ' +
        (dayEvents.length - 1) + ' more events">' +
        "+" + (dayEvents.length - 1) + " more</button>"
      : "";

    cells.push(
      '<div class="calendar-cell' + (isToday ? " today" : "") + '">' +
        '<span class="day-number">' + day + "</span>" +
        eventMarkup +
        moreEventsMarkup +
      "</div>"
    );
  }

  // Fill only the final partial week; shorter months stay compact.
  while (cells.length % 7 !== 0) {
    cells.push('<div class="calendar-cell muted-day"></div>');
  }

  $("#calendarMonthTitle").textContent = calendarMonth.toLocaleDateString(
    "en-US",
    { month: "long", year: "numeric" }
  );
  $("#listMonthTitle").textContent = $("#calendarMonthTitle").textContent;
  $("#calendarMonthCount").textContent =
    monthEvents.length + " maintenance " +
    (monthEvents.length === 1 ? "event" : "events") + " this month";
  $("#calendarGrid").innerHTML = cells.join("");

renderMiniEvents();
}

// Draw the maintenance list in date order and connect completion buttons.
function renderEvents() {
  const sortedEvents = events
    .filter(event =>
      new Date(event.date + "T12:00:00").getFullYear() ===
        calendarMonth.getFullYear() &&
      new Date(event.date + "T12:00:00").getMonth() ===
        calendarMonth.getMonth() &&
      (!maintenanceApplianceFilter ||
        String(event.applianceId) === String(maintenanceApplianceFilter))
    )
    .sort((first, second) => first.date.localeCompare(second.date));

  $("#listMonthCount").textContent =
    sortedEvents.length + " maintenance " +
    (sortedEvents.length === 1 ? "event" : "events") + " this month";

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
  '<button class="event-complete" data-complete="' +
  eventIndex +
  '" title="' +
  (event.status === "Completed" ? "Mark not completed" : "Mark completed") +
  '" aria-label="' +
  (event.status === "Completed" ? "Mark not completed" : "Mark completed") +
  '" aria-pressed="' +
  (event.status === "Completed") +
  '">✓</button>';

      return (
        '<div class="event-card" data-list-event="' + eventIndex + '">' +
          '<div class="event-card-date">' +
            "<span>" + date.month + "</span>" +
            "<b>" + date.day + "</b>" +
          "</div>" +
          '<div class="event-card-body">' +
            '<strong class="event-list-event-name' +
              (event.status === "Completed" ? " completed" : "") +
              '">' + escapeHTML(event.name) + "</strong>" +
            "<small>" + escapeHTML(event.category) + " · " +
              escapeHTML(event.time) + escapeHTML(applianceLabel) + "</small>" +
            '<p class="event-description">' +
              escapeHTML(event.description || "") + "</p>" +
          "</div>" +
          '<span class="status-pill ' +
            statusClass(maintenanceEventStatus(event)) + '">' +
            escapeHTML(maintenanceEventStatus(event)) +
          "</span>" +
          completionControl +
        "</div>"
      );
    })
    .join("");

  $("#eventList").innerHTML =
    $("#eventList").innerHTML ||
    '<p class="maintenance-empty">No maintenance events yet. Add one to get started.</p>';
  $("#maintenanceTaskCount").textContent =
    sortedEvents.length + " " +
    (sortedEvents.length === 1 ? "task" : "tasks");
    $$("[data-complete]").forEach(button => {
    button.addEventListener("click", async () => {
      const eventIndex = Number(button.dataset.complete);
      const maintenanceEvent = events[eventIndex];

      if (!maintenanceEvent) return;

      button.disabled = true;

      try {
        await toggleMaintenanceCompletion(maintenanceEvent);
        showToast("Task updated", "Maintenance status updated.");
      } catch (error) {
        console.error("Error completing event:", error);
        button.disabled = false;
        showToast("Error", error.message || "Unable to update event.");
      }
    });
  });
}

async function toggleMaintenanceCompletion(maintenanceEvent) {
  const { data: userData, error: userError } =
    await supabaseClient.auth.getUser();

  if (userError || !userData.user) {
    throw userError || new Error("Please sign in.");
  }

  const { error } = await supabaseClient
    .from("maintenance_events")
    .update({
      status: maintenanceEvent.status === "Completed" ? "Upcoming" : "Completed",
      updated_at: new Date().toISOString()
    })
    .eq("id", maintenanceEvent.id)
    .eq("user_id", userData.user.id);

  if (error) throw error;

  await loadMaintenanceEvents();
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

  $("#getMaintenanceRecommendationButton").disabled = false;
  $("#maintenanceRecommendationResult").hidden = true;

  $("#maintenanceRecommendationMessage").textContent =
  "Select “Get a suggestion” to receive a maintenance recommendation.";

  sessionStorage.setItem(
    "selectedApplianceId",
    String(selectedAppliance.id)
  );

  $("#editDetailApplianceButton").disabled = false;

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
  renderApplianceHistory(selectedAppliance);

  $("#detailIcon").className =
    "appliance-large-icon " + selectedAppliance.tone;
  $("#detailIcon").textContent = selectedAppliance.icon;

  // Enable deletion after an appliance has been selected.
  $("#deleteDetailApplianceButton").disabled = false;

  $("#maintenanceRecommendationDisclaimer").hidden = true;

  navigate("appliance-details");
  getMaintenanceRecommendation();
}

// Ask the Edge Function for a suggestion about the selected appliance.
async function getMaintenanceRecommendation(forceRefresh = false) {
  const appliance = selectedAppliance;

  if (!appliance) {
    return;
  }

  const button = $("#getMaintenanceRecommendationButton");
  const message = $("#maintenanceRecommendationMessage");
  const result = $("#maintenanceRecommendationResult");
  const disclaimer = $("#maintenanceRecommendationDisclaimer");

  button.disabled = true;
  button.textContent = "Getting suggestion...";
  message.textContent = "Reviewing this appliance’s care history...";
  result.hidden = true;
  disclaimer.hidden = true;

  try {
    const { data, error } =
      await supabaseClient.functions.invoke(
        "recommend-maintenance",
        {
          body: {
            applianceId: appliance.id,
            forceRefresh
          }
        }
      );

    if (error) {
      let errorDetails = null;

      if (error.context instanceof Response) {
        errorDetails = await error.context
          .json()
          .catch(() => null);
      }

      throw new Error(
        errorDetails?.error || error.message
      );
    }

    // Ignore a late response if the user opened another appliance.
    if (
      !selectedAppliance ||
      String(selectedAppliance.id) !== String(appliance.id)
    ) {
      return;
    }

    const recommendation = data?.recommendation;

    if (!recommendation) {
      throw new Error("The function returned no suggestion.");
    }

    $("#maintenanceRecommendationStep").textContent =
      recommendation.next_step;

    $("#maintenanceRecommendationReason").textContent =
      recommendation.reason;

    $("#maintenanceRecommendationUrgency").textContent =
      "Priority: " + recommendation.urgency;

    $("#maintenanceRecommendationTimeframe").textContent =
      "Suggested timeframe: " +
      recommendation.suggested_timeframe;

    $("#maintenanceRecommendationMoreInfo").textContent =
      recommendation.needs_more_information
        ? "For a more specific suggestion, add the exact model details or check the appliance manual."
        : "";

    result.hidden = false;
    disclaimer.hidden = false;
    message.textContent = "Suggestion generated.";
  } catch (error) {
    console.error("Maintenance recommendation error:", error);

    message.textContent =
      error instanceof Error
        ? error.message
        : "Could not get a suggestion. Please try again.";
  } finally {
    button.disabled = !selectedAppliance;
    button.textContent = "Refresh suggestion";
  }
}

/* =========================================================
   Professionals
   ========================================================= */

// Only allow normal web links from outside data.
function safeWebUrl(value) {
  return /^https?:\/\//i.test(value || "") ? value : "";
}

// Draw the latest search results (or the loading / empty states).
function renderProfessionals() {
  const list = $("#professionalList");

  if (proSearching) {
    $("#resultsCount").textContent = "";
    list.innerHTML =
      '<p class="maintenance-empty" role="status">Searching…</p>';
    return;
  }

  $("#resultsTitle").textContent =
    proSearchLabel || "Search for professionals";

  if (!proSearchLabel) {
    $("#resultsCount").textContent = "";
    list.innerHTML =
      '<p class="maintenance-empty">' +
      "Use the search above to find professionals near you." +
      "</p>";
    return;
  }

  $("#resultsCount").textContent =
    proResults.length + " result" + (proResults.length === 1 ? "" : "s");

  if (proResults.length === 0) {
    list.innerHTML =
      '<p class="maintenance-empty">' +
      "No professionals found. Try a different search or location." +
      "</p>";
    return;
  }

  list.innerHTML = proResults
    .map(place => {
      const name = place.displayName?.text || "Unnamed business";
      const openNow = place.regularOpeningHours?.openNow;
      const phone = (place.nationalPhoneNumber || "").replace(/[^\d+]/g, "");

      return (
        '<article class="pro-card">' +
          '<div class="pro-top">' +
            '<div class="pro-logo">' +
              escapeHTML(name.charAt(0).toUpperCase()) +
            "</div>" +
            "<div>" +
              "<h3>" + escapeHTML(name) + "</h3>" +
              '<div class="pro-rating">' +
                (place.rating
                  ? "★ " + escapeHTML(place.rating) +
                    "<span>" + escapeHTML(place.userRatingCount ?? 0) +
                    " Google reviews</span>"
                  : "No ratings yet") +
              "</div>" +
            "</div>" +
          "</div>" +
          '<p class="pro-description">' +
            escapeHTML(place.formattedAddress || "") +
          "</p>" +
          '<div class="pro-meta">' +
            (place.primaryTypeDisplayName?.text
              ? "<span>" + escapeHTML(place.primaryTypeDisplayName.text) + "</span>"
              : "") +
            (openNow === true ? "<span>Open now</span>" : "") +
            (openNow === false ? "<span>Closed now</span>" : "") +
          "</div>" +
          '<div class="pro-actions">' +
            '<button type="button" class="outline-button" data-view-pro="' +
              escapeHTML(place.id) + '">View profile</button>' +
            (phone
              ? '<a class="soft-button" href="tel:' + escapeHTML(phone) + '"' +
                ' style="display:grid;place-items:center;text-decoration:none">' +
                "Call</a>"
              : "") +
          "</div>" +
        "</article>"
      );
    })
    .join("");
}

// Ask the find-pros Edge Function for real businesses.
async function findProfessionals() {
  if (proSearching) return;

  const need = $("#serviceNeed").value.trim();
  const location = $("#serviceLocation").value.trim();

  if (!need || !location) {
    showToast("Missing info", "Enter what you need and where.");
    return;
  }

  proSearching = true;
  $("#findProfessionals").disabled = true;
  renderProfessionals();

  try {
    const { data, error } = await supabaseClient.functions.invoke(
      "find-pros",
      { body: { need, location } }
    );

    if (error) throw error;
    if (data?.error) throw new Error(data.error);

    proResults = data?.places || [];
    proSearchLabel = "Professionals near " + location;
  } catch (error) {
    console.error("Professional search error:", error);
    proResults = [];
    proSearchLabel = "";
    showToast("Search failed", "We couldn't load professionals. Please try again.");
  } finally {
    proSearching = false;
    $("#findProfessionals").disabled = false;
    renderProfessionals();
  }
}

// Fill the profile page from one search result and show it.
function openProfile(placeId) {
  const place = proResults.find(item => item.id === placeId);
  if (!place) return;

  currentPlace = place;
  selectedStars = 0;
  updateStars();
  $("#reviewService").value = "";
  $("#reviewComment").value = "";

  const name = place.displayName?.text || "Unnamed business";
  $("#profLogo").textContent = name.charAt(0).toUpperCase();
  $("#profName").textContent = name;
  $("#profType").textContent =
    (place.primaryTypeDisplayName?.text || "Local professional").toUpperCase();
  $("#profGoogleRating").textContent = place.rating
    ? "★ " + place.rating + " · " + (place.userRatingCount ?? 0) + " Google reviews"
    : "No Google ratings";
  $("#profAddress").textContent = place.formattedAddress || "";

  $("#profPhoneRow").hidden = !place.nationalPhoneNumber;
  $("#profPhone").textContent = place.nationalPhoneNumber || "";

  const hours = place.regularOpeningHours;
  $("#profOpenNow").textContent =
    hours?.openNow === true ? "Open now" :
    hours?.openNow === false ? "Closed now" : "Hours";
  $("#profHours").textContent =
    (hours?.weekdayDescriptions || []).join(" · ") || "Hours not listed";

  const website = $("#profWebsite");
  const url = safeWebUrl(place.websiteUri);
  website.hidden = !url;
  if (url) website.href = url;

  navigate("professional-profile");
  loadHavenlyReviews(place.id);
}

// Show reviews that Havenly users left for this business.
async function loadHavenlyReviews(placeId) {
  const box = $("#profHavenlyReviews");
  const summary = $("#profHavenlyRating");

  summary.textContent = "";
  box.innerHTML = '<p class="maintenance-empty">Loading reviews…</p>';

  const { data, error } = await supabaseClient
    .from("reviews")
    .select("reviewer_name, rating, service, comment, created_at")
    .eq("place_id", placeId)
    .order("created_at", { ascending: false })
    .limit(30);

  // Ignore a late response if the user opened a different business.
  if (!currentPlace || currentPlace.id !== placeId) return;

  if (error) {
    console.error("Review loading error:", error);
    box.innerHTML = '<p class="maintenance-empty">Could not load reviews.</p>';
    return;
  }

  if (data.length === 0) {
    summary.textContent = "No Havenly reviews yet";
    box.innerHTML =
      '<p class="maintenance-empty">Be the first to review this professional.</p>';
    return;
  }

  const average =
    data.reduce((total, review) => total + review.rating, 0) / data.length;
  summary.textContent =
    "★ " + average.toFixed(1) + " · " + data.length +
    " Havenly review" + (data.length === 1 ? "" : "s");

  box.innerHTML = data
    .map(review => {
      const reviewer = review.reviewer_name || "Havenly user";

      return (
        '<div class="review">' +
          '<div class="review-top">' +
            '<span class="avatar">' +
              escapeHTML(reviewer.charAt(0).toUpperCase()) + "</span>" +
            "<div>" +
              "<strong>" + escapeHTML(reviewer) + "</strong>" +
              "<span>" + escapeHTML(review.service || "Service") + " · " +
                escapeHTML(new Date(review.created_at).toLocaleDateString("en-US", {
                  month: "short", day: "numeric", year: "numeric"
                })) + "</span>" +
            "</div>" +
            "<b>" + "★".repeat(review.rating) + "</b>" +
          "</div>" +
          (review.comment
            ? "<p>" + escapeHTML(review.comment) + "</p>"
            : "") +
        "</div>"
      );
    })
    .join("");
}

function updateStars() {
  $$("#starInput button").forEach((star, index) => {
    star.classList.toggle("selected", index < selectedStars);
  });
}

// Save (or update) the signed-in user's review for this business.
async function submitReview() {
  if (!currentPlace) return;

  if (!selectedStars) {
    showToast("Pick a rating", "Choose 1 to 5 stars first.");
    return;
  }

  const button = $("#submitReview");
  button.disabled = true;

  try {
    const { data: userData, error: userError } =
      await supabaseClient.auth.getUser();

    if (userError || !userData.user) {
      throw userError || new Error("Please sign in.");
    }

    const { error } = await supabaseClient.from("reviews").upsert(
      {
        place_id: currentPlace.id,
        user_id: userData.user.id,
        reviewer_name:
          userData.user.user_metadata?.first_name || "Havenly user",
        rating: selectedStars,
        service: $("#reviewService").value.trim(),
        satisfaction: $("#reviewSatisfaction").value,
        comment: $("#reviewComment").value.trim()
      },
      { onConflict: "place_id,user_id" }
    );

    if (error) throw error;

    showToast("Review saved", "Thanks for sharing your experience.");
    $("#reviewService").value = "";
    $("#reviewComment").value = "";
    selectedStars = 0;
    updateStars();
    loadHavenlyReviews(currentPlace.id);
  } catch (error) {
    console.error("Review save error:", error);
    showToast("Error", error.message || "Unable to save your review.");
  } finally {
    button.disabled = false;
  }
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

// Show an AI-proposed event without saving it yet.
function showMaxEventProposal(messageRow, proposal) {
  const bubble = messageRow.querySelector(".chat-bubble");

  const card = document.createElement("div");
  card.className = "max-event-proposal";

  const title = document.createElement("strong");
  title.textContent = "Proposed calendar event";

  const details = document.createElement("p");

  const matchingAppliance = appliances.find(
    appliance =>
      String(appliance.id) === String(proposal.appliance_id)
  );

  details.textContent = [
    proposal.name,
    "Date: " + proposal.event_date,
    "Time: " + (proposal.event_time || "Not specified"),
    "Appliance: " + (matchingAppliance?.name || "General"),
    proposal.description
  ].filter(Boolean).join("\n");

  const actions = document.createElement("div");
  actions.className = "max-proposal-actions";

  const cancelButton = document.createElement("button");
  cancelButton.textContent = "Cancel";
  cancelButton.className = "button button-ghost";

  const confirmButton = document.createElement("button");
  confirmButton.textContent = "Confirm event";
  confirmButton.className = "button button-primary";

  cancelButton.addEventListener("click", () => {
    card.remove();
    addChatMessage("Event canceled. Nothing was saved.", "max");
  });

  confirmButton.addEventListener("click", async () => {
    confirmButton.disabled = true;
    cancelButton.disabled = true;
    confirmButton.textContent = "Saving...";

    try {
      const { data: userData, error: authError } =
        await supabaseClient.auth.getUser();

      if (authError || !userData.user) {
        throw authError || new Error("Please sign in.");
      }

      // Revalidate the proposal before inserting it.
      const validCategories = [
        "HVAC", "Kitchen", "Laundry", "Plumbing", "General"
      ];

      const validDate = value => {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
        const date = new Date(value + "T12:00:00Z");
        return !Number.isNaN(date.getTime()) &&
          date.toISOString().slice(0, 10) === value;
      };

      const validTime = proposal.event_time == null ||
        /^([01]\d|2[0-3]):[0-5]\d$/.test(proposal.event_time);

      if (
        typeof proposal.name !== "string" ||
        !proposal.name.trim() ||
        proposal.name.length > 150 ||
        !validCategories.includes(proposal.category) ||
        !validDate(proposal.event_date) ||
        !validTime ||
        typeof proposal.description !== "string" ||
        proposal.description.length > 2000
      ) {
        throw new Error("The proposed event contains invalid details.");
      }

      if (proposal.appliance_id != null) {
        const { data: ownedAppliance, error: applianceError } =
          await supabaseClient
            .from("appliances")
            .select("appliance_id")
            .eq("appliance_id", proposal.appliance_id)
            .eq("user_id", userData.user.id)
            .maybeSingle();

        if (applianceError) throw applianceError;

        if (!ownedAppliance) {
          throw new Error("This appliance is not available.");
        }
      }

      const { error } = await supabaseClient
        .from("maintenance_events")
        .insert({
          user_id: userData.user.id,
          name: proposal.name.trim(),
          category: proposal.category,
          appliance_id: proposal.appliance_id,
          event_date: proposal.event_date,
          event_time: proposal.event_time,
          description: proposal.description,
          status: "Upcoming"
        });

      if (error) throw error;

      const [year, month] = proposal.event_date
        .split("-")
        .map(Number);

      calendarMonth = new Date(year, month - 1, 1);

      card.remove();

      await loadMaintenanceEvents();

      addChatMessage(
        "Event saved! You can now find it in your Maintenance Log.",
        "max"
      );

      showToast("Event added", "Max's proposed event was saved.");

    } catch (error) {
      console.error("Max event creation error:", error);

      showToast(
        "Error",
        error.message || "Unable to save the event."
      );

      confirmButton.disabled = false;
      cancelButton.disabled = false;
      confirmButton.textContent = "Confirm event";
    }
  });

  actions.append(cancelButton, confirmButton);
  card.append(title, details, actions);
  bubble.appendChild(card);

  $("#chatWindow").scrollTop = $("#chatWindow").scrollHeight;
}


function showMaxApplianceProposal(messageRow, proposal) {
  const bubble = messageRow.querySelector(".chat-bubble");

  // Only display one appliance proposal per Max response.
  if (bubble.querySelector(".max-appliance-proposal")) {
    return;
  }

  const card = document.createElement("div");
card.className = "max-event-proposal max-appliance-proposal";

  const title = document.createElement("strong");
  title.textContent = "Proposed appliance";

  const details = document.createElement("p");
  details.textContent = [
    "Name: " + proposal.name,
    "Type: " + proposal.type,
    "Brand: " + (proposal.brand || "Not provided"),
    "Model: " + (proposal.model || "Not provided"),
    "Category: " + proposal.category,
    "Purchase date: " + (proposal.purchase_date || "Not provided"),
    "Last maintenance: " +
      (proposal.last_maintenance_date || "Not provided")
  ].join("\n");

  const actions = document.createElement("div");
  actions.className = "max-proposal-actions";

  const cancelButton = document.createElement("button");
  cancelButton.textContent = "Cancel";
  cancelButton.className = "button button-ghost";

  const confirmButton = document.createElement("button");
  confirmButton.textContent = "Confirm appliance";
  confirmButton.className = "button button-primary";

  cancelButton.addEventListener("click", () => {
    card.remove();
    addChatMessage("Appliance canceled. Nothing was saved.", "max");
  });

  confirmButton.addEventListener("click", async () => {
    confirmButton.disabled = true;
    cancelButton.disabled = true;
    confirmButton.textContent = "Saving...";

    try {
      const { data: userData, error: authError } =
        await supabaseClient.auth.getUser();

      if (authError || !userData.user) {
        throw authError || new Error("Please sign in.");
      }

      const validCategories = [
        "Kitchen", "Laundry", "HVAC", "Plumbing", "General"
      ];

      const validDate = value => {
        if (value == null) return true;
        if (
          typeof value !== "string" ||
          !/^\d{4}-\d{2}-\d{2}$/.test(value)
        ) return false;

        const date = new Date(value + "T12:00:00Z");
        return !Number.isNaN(date.getTime()) &&
          date.toISOString().slice(0, 10) === value;
      };

      const validOptionalText = (value, maxLength) =>
        value == null ||
        (typeof value === "string" && value.length <= maxLength);

      if (
        typeof proposal.name !== "string" ||
        !proposal.name.trim() ||
        proposal.name.length > 150 ||
        typeof proposal.type !== "string" ||
        !proposal.type.trim() ||
        proposal.type.length > 100 ||
        !validCategories.includes(proposal.category) ||
        !validOptionalText(proposal.brand, 150) ||
        !validOptionalText(proposal.model, 150) ||
        !validDate(proposal.purchase_date) ||
        !validDate(proposal.last_maintenance_date)
      ) {
        throw new Error("The proposed appliance contains invalid details.");
      }

      const { error } = await supabaseClient
        .from("appliances")
        .insert({
          user_id: userData.user.id,
          name: proposal.name.trim(),
          type: proposal.type.trim(),
          brand: proposal.brand?.trim() || null,
          model: proposal.model?.trim() || null,
          category: proposal.category,
          purchase_date: proposal.purchase_date,
          last_maintenance_date: proposal.last_maintenance_date
        });

      if (error) throw error;

      card.remove();
      await loadAppliances();
      populateEventAppliances();

      addChatMessage(
        "Appliance saved! You can now find it in My Appliances.",
        "max"
      );

      showToast("Appliance added", "Max's proposed appliance was saved.");

    } catch (error) {
      console.error("Max appliance creation error:", error);

      showToast(
        "Error",
        error.message || "Unable to save the appliance."
      );

      confirmButton.disabled = false;
      cancelButton.disabled = false;
      confirmButton.textContent = "Confirm appliance";
    }
  });

  actions.append(cancelButton, confirmButton);
  card.append(title, details, actions);
  bubble.appendChild(card);

  $("#chatWindow").scrollTop = $("#chatWindow").scrollHeight;
}


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

if (data.proposedEvent) {
  showMaxEventProposal(
    pendingMessage,
    data.proposedEvent
  );
}

if (data.proposedAppliance) {
  console.log("Displaying appliance proposal:", data.proposedAppliance);

  showMaxApplianceProposal(
    pendingMessage,
    data.proposedAppliance
  );
}
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
document.addEventListener("click", async event => {
    const homeEventCard = event.target.closest("[data-home-event]");

  if (homeEventCard && !event.target.closest("[data-home-complete]")) {
    showCalendarEventDetails(
      Number(homeEventCard.dataset.homeEvent)
    );
    return;
  }
    const listEventCard = event.target.closest("[data-list-event]");

  if (listEventCard && !event.target.closest("[data-complete]")) {
    showCalendarEventDetails(
      Number(listEventCard.dataset.listEvent)
    );
    return;
  }
  const moreEventsButton = event.target.closest("[data-calendar-more]");
  if (moreEventsButton) {
    showCalendarDayEvents(moreEventsButton.dataset.calendarMore);
    return;
  }

  const calendarEventButton = event.target.closest("[data-calendar-event]");
  if (calendarEventButton) {
    showCalendarEventDetails(
      Number(calendarEventButton.dataset.calendarEvent)
    );
    return;
  }

  if (
    event.target.closest("#closeCalendarDayModal") ||
    event.target.id === "calendarDayModal"
  ) {
    $("#calendarDayModal").hidden = true;
    return;
  }

  const homeCompletionButton = event.target.closest("[data-home-complete]");
  if (homeCompletionButton) {
    const maintenanceEvent =
      events[Number(homeCompletionButton.dataset.homeComplete)];
    if (!maintenanceEvent) return;

    homeCompletionButton.disabled = true;
    const homeEventCard = homeCompletionButton.closest(".mini-event");
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;
    const completionAnimation = homeEventCard.animate(
      [
        { opacity: 1, transform: "translateX(0)" },
        { opacity: 0, transform: "translateX(-24px)" }
      ],
      {
        duration: reduceMotion ? 1 : 350,
        easing: "ease-in",
        fill: "forwards"
      }
    );

    try {
      await completionAnimation.finished;
      await toggleMaintenanceCompletion(maintenanceEvent);
      showToast("Task updated", "Maintenance status updated.");
    } catch (error) {
      console.error("Error completing event from home:", error);
      completionAnimation.cancel();
      homeCompletionButton.disabled = false;
      showToast("Error", error.message || "Unable to update event.");
    }
    return;
  }

  if (event.target.closest("#toggleEventCompletionButton")) {
    const button = $("#toggleEventCompletionButton");
    if (!selectedMaintenanceEvent) return;

    button.disabled = true;
    try {
      await toggleMaintenanceCompletion(selectedMaintenanceEvent);
      selectedMaintenanceEvent = events.find(
        maintenanceEvent =>
          maintenanceEvent.id === selectedMaintenanceEvent.id
      ) || null;

      if (selectedMaintenanceEvent) {
        const status = $("#detailsEventStatus");
        status.textContent = maintenanceEventStatus(selectedMaintenanceEvent);
        status.className =
          selectedMaintenanceEvent.status === "Completed"
            ? "details-status-completed"
            : "details-status-upcoming";
        button.textContent =
          selectedMaintenanceEvent.status === "Completed"
            ? "Mark not complete"
            : "Mark complete";
        button.className =
          "event-details-edit event-details-completion " +
          (selectedMaintenanceEvent.status === "Completed"
            ? "mark-not-complete"
            : "mark-complete");
        button.setAttribute(
          "aria-pressed",
          String(selectedMaintenanceEvent.status === "Completed")
        );
      }

      showToast("Task updated", "Maintenance status updated.");
    } catch (error) {
      console.error("Error completing event:", error);
      showToast("Error", error.message || "Unable to update event.");
    } finally {
      button.disabled = false;
    }
    return;
  }

  if (event.target.closest("#editEventDetailsButton")) {
    if (selectedMaintenanceEvent) {
      document.getElementById("eventDetailsModal").hidden = true;
      prepareEventForm(selectedMaintenanceEvent);
      openModal("eventModal");
    }
    return;
  }

  if (event.target.closest("#deleteEventDetailsButton")) {
    if (!selectedMaintenanceEvent) return;

    const recurringSeries =
      getRecurringSeriesEvents(selectedMaintenanceEvent);
    if (recurringSeries.length > 1) {
      pendingRecurringDeletion = recurringSeries;
      $("#deleteRecurringEventsTitle").textContent =
        "Delete repeating event";
      $("#deleteRecurringEventsMessage").textContent =
        `This event is part of a series with ${recurringSeries.length} ` +
        "occurrences. Which would you like to delete?";
      $("#confirmDeleteThisEvent").textContent = "Delete this event";
      $("#confirmDeleteAllRecurringEvents").hidden = false;
      $("#deleteRecurringEventsModal").hidden = false;
      $("#eventDetailsModal").hidden = true;
      return;
    }

    pendingRecurringDeletion = null;
    $("#deleteRecurringEventsTitle").textContent = "Delete event?";
    $("#deleteRecurringEventsMessage").textContent =
      "Are you sure you want to delete this maintenance event?";
    $("#confirmDeleteThisEvent").textContent = "Delete event";
    $("#confirmDeleteAllRecurringEvents").hidden = true;
    $("#deleteRecurringEventsModal").hidden = false;
    $("#eventDetailsModal").hidden = true;
    return;
  }

  if (
    event.target.closest("#cancelDeleteRecurringEvents") ||
    event.target.closest("#cancelDeleteRecurringEventsButton") ||
    event.target.id === "deleteRecurringEventsModal"
  ) {
    $("#deleteRecurringEventsModal").hidden = true;
    pendingRecurringDeletion = null;
    if (selectedMaintenanceEvent) {
      $("#eventDetailsModal").hidden = false;
    }
    return;
  }

  if (event.target.closest("#confirmDeleteThisEvent")) {
    if (!selectedMaintenanceEvent) return;
    await deleteMaintenanceEvents([selectedMaintenanceEvent]);
    return;
  }

  if (event.target.closest("#confirmDeleteAllRecurringEvents")) {
    if (!pendingRecurringDeletion) return;
    await deleteMaintenanceEvents(pendingRecurringDeletion, true);
    return;
  }

  // Close the event details popup.
  if (
    event.target.closest("#closeEventDetails") ||
    event.target.closest("#closeEventDetailsButton") ||
    event.target.id === "eventDetailsModal"
  ) {
    document.getElementById("eventDetailsModal").hidden = true;
    return;
  }
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

async function deleteMaintenanceEvents(eventsToDelete, deleteAll = false) {
  try {
    const { data: userData, error: userError } =
      await supabaseClient.auth.getUser();

    if (userError || !userData.user) {
      throw userError || new Error("Please sign in.");
    }

    const eventIds = eventsToDelete.map(event => event.id);
    const { error } = await supabaseClient
      .from("maintenance_events")
      .delete()
      .in("id", eventIds)
      .eq("user_id", userData.user.id);

    if (error) throw error;

    $("#eventDetailsModal").hidden = true;
    $("#deleteRecurringEventsModal").hidden = true;
    selectedMaintenanceEvent = null;
    pendingRecurringDeletion = null;
    await loadMaintenanceEvents();

    showToast(
      deleteAll ? "Events deleted" : "Event deleted",
      deleteAll
        ? "All events in the series have been deleted."
        : "The maintenance event has been deleted."
    );
  } catch (error) {
    console.error("Error deleting maintenance event:", error);
    showToast(
      "Error",
      error.message || "Unable to delete the event."
    );
  }
}

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
$("#editDetailApplianceButton").addEventListener("click", () => {
  if (!selectedAppliance) {
    return;
  }

  const form = $("#applianceForm");

  applianceBeingEdited = selectedAppliance.id;

  form.elements["name"].value = selectedAppliance.name;
  form.elements["type"].value = selectedAppliance.type;
  form.elements["brand"].value = selectedAppliance.brand || "";
  form.elements["model"].value = selectedAppliance.model || "";
  form.elements["category"].value = selectedAppliance.category;
  form.elements["purchase"].value =
    selectedAppliance.purchaseDate || "";
  form.elements["last"].value =
    selectedAppliance.lastMaintenanceDate || "";

  $("#applianceModalTitle").textContent = "Edit appliance";

  openModal("applianceModal");
});

$("#deleteDetailApplianceButton").addEventListener("click", () => {
  if (selectedAppliance) {
    openDeleteApplianceModal(selectedAppliance.id);
  }
});

$("#getMaintenanceRecommendationButton").addEventListener(
  "click",
  () => getMaintenanceRecommendation(true)
);

// Mobile sidebar and modal buttons.
$("#menuButton").addEventListener("click", () => {
  $("#sidebar").classList.toggle("open");
});

$("#openEventModal").addEventListener("click", () => {
  prepareEventForm();
  openModal("eventModal");
});

$("#floatingAdd").addEventListener("click", () => {
  prepareEventForm();
  openModal("eventModal");
});

function prepareEventForm(maintenanceEvent = null) {
  const form = $("#eventForm");
  const submitButton = form.querySelector('[type="submit"]');

  form.reset();
  populateEventAppliances();
  maintenanceEventBeingEdited = maintenanceEvent?.id || null;
  maintenanceEventSeriesBeingEdited = null;
  const repeatSelect = form.elements["repeat"];
  const noRepeatOption = repeatSelect.querySelector('option[value="none"]');
  noRepeatOption.disabled = false;
  form.elements["repeatUntil"].dataset.custom = "false";
  $("#eventCompletionField").hidden = !maintenanceEvent;
  $("#eventRepeatField").hidden = false;
  $("#eventModal").querySelector("h2").textContent =
    maintenanceEvent ? "Edit maintenance event" : "Add maintenance event";
  submitButton.textContent = maintenanceEvent ? "Save changes" : "Save event";

  if (!maintenanceEvent) {
    form.elements["date"].value = getLocalDateString();
    updateEventRepeatUntil();
    return;
  }

  form.elements["name"].value = maintenanceEvent.name;
  form.elements["applianceId"].value = maintenanceEvent.applianceId || "";
  form.elements["date"].value = maintenanceEvent.date;
  form.elements["time"].value = maintenanceEvent.timeValue;
  form.elements["status"].value =
    maintenanceEvent.status === "Completed" ? "Completed" : "Upcoming";
  form.elements["description"].value = maintenanceEvent.description;

  const recurringSeries = getRecurringSeriesEvents(maintenanceEvent);
  const repeatFrequency = getRecurringSeriesFrequency(recurringSeries);
  if (repeatFrequency) {
    maintenanceEventSeriesBeingEdited = recurringSeries.sort(
      (first, second) => first.date.localeCompare(second.date)
    );
    repeatSelect.value = repeatFrequency;
    form.elements["repeatUntil"].value =
      maintenanceEventSeriesBeingEdited[
        maintenanceEventSeriesBeingEdited.length - 1
      ].date;
  }

  updateEventRepeatUntil();
}

$("#eventForm").elements["repeat"].addEventListener(
  "change",
  updateEventRepeatUntil
);
$("#eventForm").elements["date"].addEventListener(
  "change",
  updateEventRepeatUntil
);
$("#eventForm").elements["repeatUntil"].addEventListener(
  "input",
  event => {
    event.target.dataset.custom = "true";
  }
);

$$("[data-month-offset]").forEach(button => {
  button.addEventListener("click", () => {
    calendarMonth.setMonth(
      calendarMonth.getMonth() + Number(button.dataset.monthOffset)
    );
    renderCalendar();
    renderEvents();
  });
});

$("#eventForm").querySelector('[name="date"]').value = getLocalDateString();

$("#openApplianceModal").addEventListener("click", () => {
  applianceBeingEdited = null;
  $("#applianceForm").reset();
  $("#applianceModalTitle").textContent = "Add appliance";
  openModal("applianceModal");
});


$("#viewMaintenanceHistoryButton").addEventListener("click", () => {
  maintenanceApplianceFilter = selectedAppliance?.id || null;
  maintenanceHistoryFromAppliance = true;

  navigate("maintenance");

  $("#calendarView").classList.add("hidden");
  $("#listView").classList.remove("hidden");

  $$(".segment").forEach(button => {
    button.classList.toggle("active", button.dataset.view === "list");
  });

  renderEvents();
});

$("#backToApplianceHistoryButton").addEventListener("click", () => {
  navigate("appliance-details");
});


// Open the same confirmation modal from the details page.


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

// Save a new maintenance event to Supabase.
$("#eventForm").addEventListener("submit", async event => {
  event.preventDefault();

  const form = event.target;
  const saveButton = form.querySelector('[type="submit"]');
  const formData = new FormData(form);
  const repeat = formData.get("repeat") || "none";
  const repeatUntil = formData.get("repeatUntil");

  saveButton.disabled = true;
  saveButton.textContent = "Saving...";

  try {
    const { data: userData, error: userError } =
      await supabaseClient.auth.getUser();

    if (userError || !userData.user) {
      throw userError || new Error("Please sign in.");
    }

    const applianceId = formData.get("applianceId") || null;

    // Only link an appliance present in the user's loaded list.
    if (
      applianceId &&
      !appliances.some(
        appliance => String(appliance.id) === String(applianceId)
      )
    ) {
      throw new Error("Please select a valid appliance.");
    }

    const eventChanges = {
      name: String(formData.get("name") || "").trim(),
      category: maintenanceEventBeingEdited
        ? events.find(item => item.id === maintenanceEventBeingEdited)?.category || "General"
        : "General",
      appliance_id: applianceId,
      event_date: formData.get("date"),
      event_time: formData.get("time") || null,
      description: String(formData.get("description") || "").trim(),
      status: formData.get("status") || "Upcoming"
    };

    if (
      repeat !== "none" &&
      !maintenanceEventSeriesBeingEdited &&
      (!repeatUntil || repeatUntil < eventChanges.event_date)
    ) {
      throw new Error("Choose a repeat end date on or after the event date.");
    }

    if (maintenanceEventBeingEdited && maintenanceEventSeriesBeingEdited) {
      const selectedEvent = maintenanceEventSeriesBeingEdited.find(
        item => String(item.id) === String(maintenanceEventBeingEdited)
      );
      if (!selectedEvent) {
        throw new Error("Unable to find the repeating event series.");
      }

      const seriesEndDate =
        maintenanceEventSeriesBeingEdited[
          maintenanceEventSeriesBeingEdited.length - 1
        ].date;
      const eventsToReschedule = maintenanceEventSeriesBeingEdited
        .filter(item => item.date >= selectedEvent.date)
        .sort((first, second) => first.date.localeCompare(second.date));
      const repeatEndDate =
        seriesEndDate < eventChanges.event_date
          ? eventChanges.event_date
          : seriesEndDate;
      let recurringDates = getRecurringDates(
        eventChanges.event_date,
        repeat,
        repeatEndDate
      );
      if (repeat !== "none" && recurringDates.length < 2) {
        recurringDates = getRecurringDates(
          eventChanges.event_date,
          repeat
        ).slice(0, 2);
      }
      const eventsToUpdate = eventsToReschedule.slice(
        0,
        recurringDates.length
      );

      for (let index = 0; index < eventsToUpdate.length; index += 1) {
        const existingEvent = eventsToUpdate[index];
        const changes = {
          ...eventChanges,
          event_date: recurringDates[index],
          status: String(existingEvent.id) ===
            String(maintenanceEventBeingEdited)
            ? eventChanges.status
            : existingEvent.status
        };
        const { error } = await supabaseClient
          .from("maintenance_events")
          .update(changes)
          .eq("id", existingEvent.id)
          .eq("user_id", userData.user.id);

        if (error) throw error;
      }

      const recurringEvents = recurringDates
        .slice(eventsToUpdate.length)
        .map(date => ({
          ...eventChanges,
          event_date: date,
          status: "Upcoming",
          user_id: userData.user.id
        }));

      if (recurringEvents.length > 0) {
        const { error } = await supabaseClient
          .from("maintenance_events")
          .insert(recurringEvents);

        if (error) throw error;
      }

      const eventIdsToDelete = eventsToReschedule
        .slice(recurringDates.length)
        .map(item => item.id);
      if (eventIdsToDelete.length > 0) {
        const { error } = await supabaseClient
          .from("maintenance_events")
          .delete()
          .in("id", eventIdsToDelete)
          .eq("user_id", userData.user.id);

        if (error) throw error;
      }
    } else {
      let saveQuery = supabaseClient.from("maintenance_events");
      if (maintenanceEventBeingEdited) {
        saveQuery = saveQuery
          .update(eventChanges)
          .eq("id", maintenanceEventBeingEdited)
          .eq("user_id", userData.user.id);
      } else {
        const recurringDates = getRecurringDates(
          eventChanges.event_date,
          repeat,
          repeat === "none" ? null : repeatUntil
        );

        const eventsToInsert = recurringDates.map(date => ({
          ...eventChanges,
          event_date: date,
          user_id: userData.user.id
        }));

        saveQuery = saveQuery.insert(eventsToInsert);
      }

      const { error } = await saveQuery;

      if (error) throw error;

      if (maintenanceEventBeingEdited && repeat !== "none") {
        const recurringDates = getRecurringDates(
          eventChanges.event_date,
          repeat,
          repeatUntil
        );
        const recurringEvents = recurringDates.slice(1).map(date => ({
          ...eventChanges,
          event_date: date,
          status: "Upcoming",
          user_id: userData.user.id
        }));

        if (recurringEvents.length > 0) {
          const { error: recurringError } = await supabaseClient
            .from("maintenance_events")
            .insert(recurringEvents);

          if (recurringError) throw recurringError;
        }
      }
    }

    const [year, month] = String(eventChanges.event_date)
    .split("-")
    .map(Number);

  calendarMonth = new Date(year, month - 1, 1);

    form.reset();
    closeModal("eventModal");

    const wasEditing = Boolean(maintenanceEventBeingEdited);
    maintenanceEventBeingEdited = null;
    maintenanceEventSeriesBeingEdited = null;
    selectedMaintenanceEvent = null;
    await loadMaintenanceEvents();

    showToast(
      wasEditing ? "Event updated" : "Event added",
      wasEditing
        ? "Your maintenance event has been updated."
        : "Your maintenance event has been saved."
    );

  } catch (error) {
    console.error("Error saving maintenance event:", error);

    showToast(
      "Error",
      error.message || "Unable to save the event."
    );
  } finally {
    saveButton.disabled = false;
    saveButton.textContent = maintenanceEventBeingEdited
      ? "Save changes"
      : "Save event";
  }

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
  const shouldRefreshSelectedAppliance =
    wasEditing &&
    currentPage === "appliance-details" &&
    selectedAppliance &&
    String(selectedAppliance.id) === String(applianceForUI.id);

applianceBeingEdited = null;

renderAppliances();
event.target.reset();
$("#applianceModalTitle").textContent = "Add appliance";
closeModal("applianceModal");

if (shouldRefreshSelectedAppliance) {
  openAppliance(applianceForUI.id);
}

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

// Search button and Enter key.
$("#findProfessionals").addEventListener("click", findProfessionals);

["#serviceNeed", "#serviceLocation"].forEach(selector => {
  $(selector).addEventListener("keydown", event => {
    if (event.key === "Enter") {
      event.preventDefault();
      findProfessionals();
    }
  });
});

// "View profile" buttons are created dynamically, so listen on the list.
$("#professionalList").addEventListener("click", event => {
  const button = event.target.closest("[data-view-pro]");
  if (button) openProfile(button.dataset.viewPro);
});

// Star rating and review submission.
$$("#starInput button").forEach((button, index) => {
  button.type = "button";
  button.addEventListener("click", () => {
    selectedStars = index + 1;
    updateStars();
  });
});

$("#submitReview").addEventListener("click", submitReview);

/* =========================================================
   Initial page rendering
   ========================================================= */

// Restore the page represented by the current URL hash.
navigate(location.hash.slice(1) || "home", false);

// Render the calendar shell before the signed-in user's records load.
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

// Sign out from either the sidebar or the account popup.
async function handleSignOut() {
  const { error } = await supabaseClient.auth.signOut();

  if (error) {
    alert("Sign out failed: " + error.message);
    return;
  }

  // Close the popup before switching back to the login page.
  closeModal("accountModal");

  currentAccountUser = null;
  appliances = [];
  appliancesLoading = true;


    proResults = [];
  proSearchLabel = "";
  currentPlace = null;
  $("#serviceLocation").value = "";

  events = [];
  maintenanceApplianceFilter = null;

  renderCalendar();
  renderEvents();
  renderMiniEvents();

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
}

$$("[data-sign-out]").forEach(button => {
  button.addEventListener("click", handleSignOut);
});

// Reveal the app after authentication and load the user's data.
async function showMainApp() {
  loginPage.style.display = "none";
  appShell.style.display = "flex";

  loadSavedMaxConversations();

  await loadAccount();
  await loadAppliances();
  await loadMaintenanceEvents();

  // Restore the selected appliance after the user's data has loaded.
  if (currentPage === "appliance-details") {
    const savedApplianceId =
      sessionStorage.getItem("selectedApplianceId");

    const applianceStillExists = appliances.some(
      appliance =>
        String(appliance.id) === String(savedApplianceId)
    );

    if (applianceStillExists) {
      openAppliance(savedApplianceId);
    } else {
      navigate("appliances", false);
    }
  }
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
