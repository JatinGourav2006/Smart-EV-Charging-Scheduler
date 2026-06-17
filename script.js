const state = {
  vehicles: []
};

const algorithmNames = {
  fcfs: "FCFS",
  sjf: "SJF",
  priority: "Priority Scheduling",
  rr: "Round Robin",
  mlq: "Multilevel Queue",
  mlfq: "Multilevel Feedback Queue"
};

const form = document.getElementById("vehicleForm");
const vehicleTableBody = document.getElementById("vehicleTableBody");
const resultTableBody = document.getElementById("resultTableBody");
const vehicleCount = document.getElementById("vehicleCount");
const algorithmSelect = document.getElementById("algorithmSelect");
const timeQuantumInput = document.getElementById("timeQuantum");
const executionOrder = document.getElementById("executionOrder");
const averageWaiting = document.getElementById("averageWaiting");
const resultSubtitle = document.getElementById("resultSubtitle");
const ganttChart = document.getElementById("ganttChart");
const comparisonList = document.getElementById("comparisonList");
const bestAlgorithm = document.getElementById("bestAlgorithm");
const headerQueueCount = document.getElementById("headerQueueCount");

form.addEventListener("submit", handleVehicleSubmit);
document.getElementById("runBtn").addEventListener("click", runSelectedAlgorithm);
document.getElementById("suggestBtn").addEventListener("click", suggestBestAlgorithm);
document.getElementById("resetBtn").addEventListener("click", resetApp);
document.getElementById("sampleBtn").addEventListener("click", loadSampleData);

function handleVehicleSubmit(event) {
  event.preventDefault();

  const vehicle = {
    id: document.getElementById("vehicleId").value.trim(),
    arrival: Number(document.getElementById("arrivalTime").value),
    charging: Number(document.getElementById("chargingTime").value),
    battery: Number(document.getElementById("batteryPercentage").value)
  };

  if (!isValidVehicle(vehicle)) {
    alert("Please enter a valid order. Processing time must be at least 1 and priority must be 1-10.");
    return;
  }

  if (state.vehicles.some((item) => item.id.toLowerCase() === vehicle.id.toLowerCase())) {
    alert("Order ID already exists. Please use a unique ID.");
    return;
  }

  state.vehicles.push(vehicle);
  form.reset();
  renderVehicles();
  clearSchedule();
}

function isValidVehicle(vehicle) {
  return vehicle.id
    && Number.isFinite(vehicle.arrival)
    && Number.isFinite(vehicle.charging)
    && Number.isFinite(vehicle.battery)
    && vehicle.arrival >= 0
    && vehicle.charging >= 1
    && vehicle.battery >= 1
    && vehicle.battery <= 10;
}

function cloneVehicles() {
  return state.vehicles.map((vehicle, index) => ({
    ...vehicle,
    index,
    originalArrival: vehicle.arrival,
    remaining: vehicle.charging
  }));
}

function runSelectedAlgorithm() {
  if (!state.vehicles.length) {
    alert("Add at least one order before running a dispatch schedule.");
    return;
  }

  const quantum = getQuantum();
  const selected = algorithmSelect.value;
  const result = runAlgorithm(selected, quantum);
  renderSchedule(result, algorithmNames[selected]);
}

function runAlgorithm(type, quantum) {
  const vehicles = cloneVehicles();

  if (type === "fcfs") return scheduleFcfs(vehicles);
  if (type === "sjf") return scheduleSjf(vehicles);
  if (type === "priority") return schedulePriority(vehicles);
  if (type === "rr") return scheduleRoundRobin(vehicles, quantum);
  if (type === "mlq") return scheduleMultilevelQueue(vehicles, quantum);
  return scheduleMlfq(vehicles, quantum);
}

// FCFS processes orders in the same order they arrive at the warehouse.
function scheduleFcfs(vehicles) {
  const ordered = vehicles.sort((a, b) => a.arrival - b.arrival || a.index - b.index);
  let time = 0;
  const segments = [];

  ordered.forEach((vehicle) => {
    if (time < vehicle.arrival) {
      segments.push(createIdleSegment(time, vehicle.arrival));
      time = vehicle.arrival;
    }

    const start = time;
    const end = start + vehicle.charging;
    segments.push(createSegment(vehicle, start, end));
    vehicle.start = start;
    vehicle.end = end;
    time = end;
  });

  return buildResult(vehicles, segments);
}

// SJF always picks the available order with the shortest processing time.
function scheduleSjf(vehicles) {
  return scheduleNonPreemptive(vehicles, (ready) => {
    return ready.sort((a, b) => a.charging - b.charging || a.arrival - b.arrival || a.index - b.index)[0];
  });
}

// Priority scheduling uses the original priority comparison from the base project.
function schedulePriority(vehicles) {
  return scheduleNonPreemptive(vehicles, (ready) => {
    return ready.sort((a, b) => a.battery - b.battery || a.arrival - b.arrival || a.index - b.index)[0];
  });
}

function scheduleNonPreemptive(vehicles, picker) {
  const pending = [...vehicles];
  const segments = [];
  let time = getFirstArrival(pending);

  while (pending.length) {
    const ready = pending.filter((vehicle) => vehicle.arrival <= time);

    if (!ready.length) {
      const nextArrival = Math.min(...pending.map((vehicle) => vehicle.arrival));
      segments.push(createIdleSegment(time, nextArrival));
      time = nextArrival;
      continue;
    }

    const selected = picker(ready);
    const start = time;
    const end = start + selected.charging;
    selected.start = start;
    selected.end = end;
    segments.push(createSegment(selected, start, end));
    time = end;
    pending.splice(pending.findIndex((vehicle) => vehicle.id === selected.id), 1);
  }

  return buildResult(vehicles, segments);
}

// Round Robin gives every ready order a repeated fixed time slice until it finishes.
function scheduleRoundRobin(vehicles, quantum) {
  const pending = [...vehicles].sort((a, b) => a.arrival - b.arrival || a.index - b.index);
  const queue = [];
  const segments = [];
  let time = pending.length ? pending[0].arrival : 0;

  moveArrivalsToQueue(pending, queue, time);

  while (queue.length || pending.length) {
    if (!queue.length) {
      const nextArrival = pending[0].arrival;
      segments.push(createIdleSegment(time, nextArrival));
      time = nextArrival;
      moveArrivalsToQueue(pending, queue, time);
    }

    const vehicle = queue.shift();
    if (vehicle.start === undefined) vehicle.start = time;

    const slice = Math.min(quantum, vehicle.remaining);
    const start = time;
    const end = start + slice;
    vehicle.remaining -= slice;
    time = end;
    segments.push(createSegment(vehicle, start, end));

    moveArrivalsToQueue(pending, queue, time);

    if (vehicle.remaining > 0) {
      queue.push(vehicle);
    } else {
      vehicle.end = time;
    }
  }

  return buildResult(vehicles, mergeAdjacentSegments(segments));
}

// Multilevel Queue separates urgent orders from normal orders.
function scheduleMultilevelQueue(vehicles, quantum) {
  const urgentIds = new Set(vehicles.filter((vehicle) => vehicle.battery < 30).map((vehicle) => vehicle.id));
  const urgentResult = schedulePriority(vehicles.filter((vehicle) => urgentIds.has(vehicle.id)));
  const normalVehicles = vehicles.filter((vehicle) => !urgentIds.has(vehicle.id));
  const segments = [...urgentResult.segments];
  const completedUrgent = new Map(urgentResult.rows.map((row) => [row.id, row]));
  let time = segments.length ? Math.max(...segments.map((segment) => segment.end)) : getFirstArrival(normalVehicles);

  normalVehicles.forEach((vehicle) => {
    if (time < vehicle.arrival) time = vehicle.arrival;
    vehicle.arrival = Math.max(vehicle.arrival, time);
  });

  const normalResult = scheduleRoundRobin(normalVehicles, quantum);
  const allSegments = mergeAdjacentSegments([...segments, ...normalResult.segments]);

  vehicles.forEach((vehicle) => {
    const urgentRow = completedUrgent.get(vehicle.id);
    const normalRow = normalResult.rows.find((row) => row.id === vehicle.id);
    if (urgentRow) {
      vehicle.start = urgentRow.start;
      vehicle.end = urgentRow.end;
    }
    if (normalRow) {
      vehicle.start = normalRow.start;
      vehicle.end = normalRow.end;
    }
  });

  return buildResult(vehicles, allSegments);
}

// MLFQ starts all orders in a fast-response queue, then demotes unfinished jobs to longer quanta.
function scheduleMlfq(vehicles, quantum) {
  const pending = [...vehicles].sort((a, b) => a.arrival - b.arrival || a.index - b.index);
  const queues = [[], [], []];
  const quantums = [quantum, quantum * 2, Number.POSITIVE_INFINITY];
  const segments = [];
  let time = pending.length ? pending[0].arrival : 0;

  moveArrivalsToQueue(pending, queues[0], time);

  while (pending.length || queues.some((queue) => queue.length)) {
    if (!queues.some((queue) => queue.length)) {
      const nextArrival = pending[0].arrival;
      segments.push(createIdleSegment(time, nextArrival));
      time = nextArrival;
      moveArrivalsToQueue(pending, queues[0], time);
    }

    const level = queues.findIndex((queue) => queue.length);
    const vehicle = queues[level].shift();
    if (vehicle.start === undefined) vehicle.start = time;

    const slice = Math.min(quantums[level], vehicle.remaining);
    const start = time;
    const end = start + slice;
    vehicle.remaining -= slice;
    time = end;
    segments.push(createSegment(vehicle, start, end));

    moveArrivalsToQueue(pending, queues[0], time);

    if (vehicle.remaining > 0) {
      queues[Math.min(level + 1, queues.length - 1)].push(vehicle);
    } else {
      vehicle.end = time;
    }
  }

  return buildResult(vehicles, mergeAdjacentSegments(segments));
}

function createSegment(vehicle, start, end) {
  return {
    id: vehicle.id,
    start,
    end,
    duration: end - start,
    idle: false
  };
}

function createIdleSegment(start, end) {
  return {
    id: "Idle",
    start,
    end,
    duration: end - start,
    idle: true
  };
}

function moveArrivalsToQueue(pending, queue, time) {
  while (pending.length && pending[0].arrival <= time) {
    queue.push(pending.shift());
  }
}

function getFirstArrival(vehicles) {
  return vehicles.length ? Math.min(...vehicles.map((vehicle) => vehicle.arrival)) : 0;
}

function mergeAdjacentSegments(segments) {
  return segments.reduce((merged, segment) => {
    const previous = merged[merged.length - 1];
    if (previous && previous.id === segment.id && previous.end === segment.start) {
      previous.end = segment.end;
      previous.duration += segment.duration;
    } else if (segment.duration > 0) {
      merged.push({ ...segment });
    }
    return merged;
  }, []);
}

function buildResult(vehicles, segments) {
  const rows = vehicles
    .map((vehicle) => ({
      id: vehicle.id,
      start: vehicle.start,
      end: vehicle.end,
      waiting: vehicle.end - vehicle.originalArrival - vehicle.charging,
      turnaround: vehicle.end - vehicle.originalArrival
    }))
    .sort((a, b) => a.start - b.start || a.end - b.end);

  const averageWait = rows.length
    ? rows.reduce((sum, row) => sum + row.waiting, 0) / rows.length
    : 0;

  return {
    rows,
    segments: segments.filter((segment) => segment.duration > 0),
    averageWait,
    order: rows.map((row) => row.id)
  };
}

function suggestBestAlgorithm() {
  if (!state.vehicles.length) {
    alert("Add at least one order before comparing algorithms.");
    return;
  }

  const quantum = getQuantum();
  const results = Object.keys(algorithmNames).map((type) => ({
    type,
    name: algorithmNames[type],
    result: runAlgorithm(type, quantum)
  }));

  results.sort((a, b) => a.result.averageWait - b.result.averageWait);
  renderComparison(results);
  renderSchedule(results[0].result, results[0].name);

  bestAlgorithm.hidden = false;
  bestAlgorithm.innerHTML = `<strong>${results[0].name}</strong> is best for this dispatch queue with an average waiting time of <strong>${formatNumber(results[0].result.averageWait)}</strong>.`;
}

function getQuantum() {
  const value = Number(timeQuantumInput.value);
  return Number.isFinite(value) && value > 0 ? value : 1;
}

function renderVehicles() {
  vehicleCount.textContent = `${state.vehicles.length} ${state.vehicles.length === 1 ? "order" : "orders"}`;
  headerQueueCount.textContent = String(state.vehicles.length);

  if (!state.vehicles.length) {
    vehicleTableBody.innerHTML = `<tr><td colspan="4" class="empty-state">No orders added yet.</td></tr>`;
    return;
  }

  vehicleTableBody.innerHTML = state.vehicles
    .map((vehicle) => `
      <tr>
        <td>${escapeHtml(vehicle.id)}</td>
        <td>${vehicle.arrival}</td>
        <td>${vehicle.charging}</td>
        <td><span class="priority-pill ${getPriorityClass(vehicle.battery)}">${getPriorityLabel(vehicle.battery)}</span></td>
      </tr>
    `)
    .join("");
}

function renderSchedule(result, algorithmName) {
  resultSubtitle.textContent = `${algorithmName} generated ${result.segments.length} timeline block${result.segments.length === 1 ? "" : "s"}.`;
  executionOrder.textContent = result.order.join(" -> ");
  averageWaiting.textContent = formatNumber(result.averageWait);

  resultTableBody.innerHTML = result.rows
    .map((row) => `
      <tr>
        <td>${escapeHtml(row.id)}</td>
        <td>${row.start}</td>
        <td>${row.end}</td>
        <td>${formatNumber(row.waiting)}</td>
        <td>${formatNumber(row.turnaround)}</td>
      </tr>
    `)
    .join("");

  renderGanttChart(result.segments);
}

function renderGanttChart(segments) {
  if (!segments.length) {
    ganttChart.innerHTML = `<div class="empty-state chart-empty">No timeline to display.</div>`;
    return;
  }

  const maxDuration = Math.max(...segments.map((segment) => segment.duration));
  const track = segments
    .map((segment) => {
      const width = Math.max(72, (segment.duration / maxDuration) * 150);
      return `
        <div class="gantt-block ${segment.idle ? "idle" : ""}" style="width: ${width}px">
          <span>${escapeHtml(segment.id)}</span>
          <small>${segment.start} - ${segment.end}</small>
        </div>
      `;
    })
    .join("");

  const axis = segments
    .map((segment) => `<span>${segment.start}</span>`)
    .join("") + `<span>${segments[segments.length - 1].end}</span>`;

  ganttChart.innerHTML = `
    <div class="gantt-track">${track}</div>
    <div class="time-axis">${axis}</div>
  `;
}

function renderComparison(results) {
  comparisonList.innerHTML = results
    .map((item, index) => `
      <div class="comparison-row ${index === 0 ? "best" : ""}">
        <strong>${item.name}</strong>
        <span>${formatNumber(item.result.averageWait)} avg wait</span>
      </div>
    `)
    .join("");
}

function clearSchedule() {
  resultSubtitle.textContent = "Run an algorithm to see dispatch order and timing metrics.";
  executionOrder.textContent = "-";
  averageWaiting.textContent = "-";
  resultTableBody.innerHTML = `<tr><td colspan="5" class="empty-state">No dispatch schedule generated.</td></tr>`;
  ganttChart.innerHTML = `<div class="empty-state chart-empty">No timeline to display.</div>`;
  comparisonList.innerHTML = `<div class="empty-state">Use Suggest Best Algorithm to compare all methods.</div>`;
  bestAlgorithm.hidden = true;
  bestAlgorithm.textContent = "";
}

function resetApp() {
  state.vehicles = [];
  form.reset();
  timeQuantumInput.value = 2;
  renderVehicles();
  clearSchedule();
}

function loadSampleData() {
  state.vehicles = [
    { id: "ORD-1001", arrival: 0, charging: 5, battery: 9 },
    { id: "ORD-1002", arrival: 1, charging: 3, battery: 6 },
    { id: "ORD-1003", arrival: 2, charging: 8, battery: 3 },
    { id: "ORD-1004", arrival: 4, charging: 4, battery: 8 },
    { id: "ORD-1005", arrival: 6, charging: 2, battery: 5 }
  ];
  renderVehicles();
  clearSchedule();
}

function getPriorityClass(priority) {
  if (priority <= 3) return "priority-low";
  if (priority <= 7) return "priority-mid";
  return "priority-high";
}

function getPriorityLabel(priority) {
  if (priority <= 3) return `${priority} Low`;
  if (priority <= 7) return `${priority} Medium`;
  return `${priority} High`;
}

function formatNumber(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

renderVehicles();
clearSchedule();
