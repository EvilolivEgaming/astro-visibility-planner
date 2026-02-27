const AU_KM = 149597870.7;
const ARCSEC_PER_RADIAN = 206264.80624709636;
const REFRACTION_PREFERENCE = true;

const PLANETS = {
  Mercury: { body: () => Astronomy.Body.Mercury, diameterKm: 4879.4 },
  Venus: { body: () => Astronomy.Body.Venus, diameterKm: 12103.6 },
  Mars: { body: () => Astronomy.Body.Mars, diameterKm: 6792.4 },
  Jupiter: { body: () => Astronomy.Body.Jupiter, diameterKm: 142984 },
  Saturn: { body: () => Astronomy.Body.Saturn, diameterKm: 120536 },
  Uranus: { body: () => Astronomy.Body.Uranus, diameterKm: 51118 },
  Neptune: { body: () => Astronomy.Body.Neptune, diameterKm: 49528 }
};

const dom = {
  latitude: document.getElementById("latitude"),
  longitude: document.getElementById("longitude"),
  elevation: document.getElementById("elevation"),
  detectLocation: document.getElementById("detect-location"),
  locationStatus: document.getElementById("location-status"),
  planet: document.getElementById("planet"),
  modeRadios: Array.from(document.querySelectorAll('input[name="mode"]')),
  singleControls: document.getElementById("single-controls"),
  nightControls: document.getElementById("night-controls"),
  singleDate: document.getElementById("single-date"),
  singleTime: document.getElementById("single-time"),
  nightDate: document.getElementById("night-date"),
  threshold: document.getElementById("threshold"),
  calculate: document.getElementById("calculate"),
  status: document.getElementById("status"),
  error: document.getElementById("error"),
  loading: document.getElementById("loading"),
  nightSummary: document.getElementById("night-summary"),
  chartWrap: document.getElementById("chart-wrap"),
  nightRange: document.getElementById("night-range"),
  thresholdRanges: document.getElementById("threshold-ranges"),
  chart: document.getElementById("altitude-chart"),
  out: {
    ra: document.getElementById("out-ra"),
    dec: document.getElementById("out-dec"),
    jd: document.getElementById("out-jd"),
    alt: document.getElementById("out-alt"),
    az: document.getElementById("out-az"),
    above: document.getElementById("out-above"),
    rise: document.getElementById("out-rise"),
    transit: document.getElementById("out-transit"),
    set: document.getElementById("out-set"),
    maxAlt: document.getElementById("out-max-alt"),
    timeThreshold: document.getElementById("out-time-threshold"),
    bestWindow: document.getElementById("out-best-window"),
    mag: document.getElementById("out-mag"),
    phaseAngle: document.getElementById("out-phase-angle"),
    phaseFraction: document.getElementById("out-phase-fraction"),
    phasePercent: document.getElementById("out-phase-percent"),
    angularDiameter: document.getElementById("out-angular-diameter")
  }
};

let lastChartData = null;

initialize();

function initialize() {
  if (!window.Astronomy) {
    setError("Astronomy Engine failed to load from CDN.");
    return;
  }

  const now = new Date();
  dom.singleDate.value = formatDateInput(now);
  dom.nightDate.value = formatDateInput(now);
  dom.singleTime.value = formatTimeInput(now);

  dom.modeRadios.forEach((radio) => {
    radio.addEventListener("change", updateModeVisibility);
  });

  dom.detectLocation.addEventListener("click", detectLocation);
  dom.calculate.addEventListener("click", onCalculate);

  window.addEventListener("resize", () => {
    if (lastChartData) {
      drawAltitudeChart(lastChartData.samples, lastChartData.threshold, lastChartData.maxSample);
    }
  });

  updateModeVisibility();
  setStatus("Ready. Enter location and compute.");
}

function updateModeVisibility() {
  const mode = getMode();
  dom.singleControls.classList.toggle("hidden", mode !== "single");
  dom.nightControls.classList.toggle("hidden", mode !== "night");
}

function getMode() {
  const selected = dom.modeRadios.find((r) => r.checked);
  return selected ? selected.value : "single";
}

function detectLocation() {
  if (!navigator.geolocation) {
    setError("Geolocation is not supported in this browser. Enter manual coordinates.");
    return;
  }

  setError("");
  setLocationStatus("Requesting browser geolocation...");

  navigator.geolocation.getCurrentPosition(
    (position) => {
      const { latitude, longitude, altitude } = position.coords;
      dom.latitude.value = latitude.toFixed(6);
      dom.longitude.value = longitude.toFixed(6);
      dom.elevation.value = Number.isFinite(altitude) ? altitude.toFixed(1) : "0";
      setLocationStatus("Location detected. You can still override manually.");
    },
    (err) => {
      const message = geolocationErrorMessage(err);
      setError(`${message} Use manual latitude/longitude entry.`);
      setLocationStatus("Automatic location unavailable.");
    },
    {
      enableHighAccuracy: true,
      timeout: 12000,
      maximumAge: 60000
    }
  );
}

function geolocationErrorMessage(err) {
  switch (err.code) {
    case err.PERMISSION_DENIED:
      return "Location permission denied.";
    case err.POSITION_UNAVAILABLE:
      return "Location information unavailable.";
    case err.TIMEOUT:
      return "Location request timed out.";
    default:
      return "Geolocation failed.";
  }
}

async function onCalculate() {
  setError("");
  setStatus("Computing...");
  showLoading(true);

  await sleep(20);

  try {
    const observer = buildObserver();
    const planetName = dom.planet.value;
    const planetInfo = PLANETS[planetName];

    if (!planetInfo) {
      throw new Error("Invalid planet selection.");
    }

    const body = planetInfo.body();
    const mode = getMode();

    if (mode === "single") {
      runSingleCalculation(observer, body, planetName);
    } else {
      runNightScan(observer, body, planetName);
    }

    setStatus("Calculation complete.");
  } catch (err) {
    clearOutputs();
    setError(err.message || "Calculation failed.");
    setStatus("Calculation failed.");
  } finally {
    showLoading(false);
  }
}

function runSingleCalculation(observer, body, planetName) {
  const date = parseLocalDateTime(dom.singleDate.value, dom.singleTime.value);
  const snapshot = calculateSnapshot(body, observer, date, planetName);
  const rise = searchAltitudeSafe(body, observer, +1, snapshot.time, 2.0, 0.0);
  const set = searchAltitudeSafe(body, observer, -1, snapshot.time, 2.0, 0.0);
  const transit = searchHourAngleSafe(body, observer, 0.0, snapshot.time, +1);

  const transitAlt = transit && transit.hor ? `${formatDegrees(transit.hor.altitude)} deg` : "--";

  renderSnapshot(snapshot);
  dom.out.rise.textContent = formatAstroTime(rise);
  dom.out.transit.textContent = formatTransit(transit);
  dom.out.set.textContent = formatAstroTime(set);
  dom.out.maxAlt.textContent = transitAlt;
  dom.out.timeThreshold.textContent = "-- (night scan mode)";
  dom.out.bestWindow.textContent = "-- (night scan mode)";

  dom.nightSummary.classList.add("hidden");
  dom.chartWrap.classList.add("hidden");
  lastChartData = null;
}

function runNightScan(observer, body, planetName) {
  const dateStr = dom.nightDate.value;
  if (!dateStr) {
    throw new Error("Night date is required.");
  }

  const threshold = Number(dom.threshold.value);
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 89) {
    throw new Error("Threshold must be between 0 and 89 degrees.");
  }

  const twilight = findAstronomicalNight(observer, dateStr);
  const samples = sampleAltitudes(body, observer, twilight.sunset.date, twilight.sunrise.date, 5, planetName);

  if (!samples.length) {
    throw new Error("No samples generated for night scan.");
  }

  const stats = analyzeSamples(samples);
  const thresholdInfo = findThresholdWindows(samples, threshold);

  const spanDays = (twilight.sunrise.date.getTime() - twilight.sunset.date.getTime()) / 86400000 + 0.01;
  const rise = astroTimeInRange(
    searchAltitudeSafe(body, observer, +1, twilight.sunset, spanDays, 0.0),
    twilight.sunset.date,
    twilight.sunrise.date
  );
  const set = astroTimeInRange(
    searchAltitudeSafe(body, observer, -1, twilight.sunset, spanDays, 0.0),
    twilight.sunset.date,
    twilight.sunrise.date
  );

  let transit = eventInRange(
    searchHourAngleSafe(body, observer, 0.0, twilight.sunset, +1),
    twilight.sunset.date,
    twilight.sunrise.date
  );

  if (!transit) {
    transit = eventInRange(
      searchHourAngleSafe(body, observer, 0.0, twilight.sunrise, -1),
      twilight.sunset.date,
      twilight.sunrise.date
    );
  }

  const representative = stats.maxSample.snapshot;
  renderSnapshot(representative);

  const neverRises = stats.maxSample.altitude <= 0;
  const bestWindow = selectBestWindow(thresholdInfo.windows, stats.maxSample.date);

  dom.out.rise.textContent = rise ? formatAstroTime(rise) : neverRises ? "Never rises during this night" : "No rise event in interval";
  dom.out.transit.textContent = transit ? formatTransit(transit) : `${formatLocalDateTime(stats.maxSample.date)} (approx peak)`;
  dom.out.set.textContent = set ? formatAstroTime(set) : neverRises ? "--" : "No set event in interval";
  dom.out.maxAlt.textContent = `${formatDegrees(stats.maxSample.altitude)} deg at ${formatLocalDateTime(stats.maxSample.date)}`;
  dom.out.timeThreshold.textContent = formatDuration(thresholdInfo.totalMinutes);

  if (neverRises) {
    dom.out.bestWindow.textContent = "Object never rises above the horizon during this astronomical night.";
  } else if (!bestWindow) {
    dom.out.bestWindow.textContent = `No interval above ${threshold.toFixed(1)} deg.`;
  } else {
    dom.out.bestWindow.textContent = formatRange(bestWindow.start, bestWindow.end);
  }

  dom.nightRange.textContent = `Astronomical night (-18 deg Sun altitude): ${formatRange(twilight.sunset.date, twilight.sunrise.date)}`;

  if (thresholdInfo.windows.length) {
    dom.thresholdRanges.textContent = `Intervals above ${threshold.toFixed(1)} deg: ${thresholdInfo.windows
      .map((w) => formatRange(w.start, w.end))
      .join("; ")}`;
  } else {
    dom.thresholdRanges.textContent = `No time above ${threshold.toFixed(1)} deg during this night.`;
  }

  dom.nightSummary.classList.remove("hidden");
  dom.chartWrap.classList.remove("hidden");

  lastChartData = {
    samples,
    threshold,
    maxSample: stats.maxSample
  };
  drawAltitudeChart(samples, threshold, stats.maxSample);
}

function calculateSnapshot(body, observer, date, planetName) {
  const time = new Astronomy.AstroTime(date);
  const equ = Astronomy.Equator(body, time, observer, true, true);
  const hor = horizonWithRefraction(time, observer, equ.ra, equ.dec);
  const illumination = Astronomy.Illumination(body, time);
  const angularDiameter = angularDiameterArcsec(equ.dist, planetName);

  return {
    time,
    date,
    equ,
    hor,
    illumination,
    angularDiameter,
    jd: julianDate(date)
  };
}

function horizonWithRefraction(time, observer, ra, dec) {
  try {
    return Astronomy.Horizon(time, observer, ra, dec, REFRACTION_PREFERENCE);
  } catch (_) {
    return Astronomy.Horizon(time, observer, ra, dec, "normal");
  }
}

function findAstronomicalNight(observer, dateStr) {
  const localNoon = parseLocalDateTime(dateStr, "12:00");
  const noonTime = new Astronomy.AstroTime(localNoon);

  const sunset = searchAltitudeSafe(Astronomy.Body.Sun, observer, -1, noonTime, 1.6, -18.0);
  if (!sunset) {
    throw new Error("Could not find astronomical sunset for this date/location.");
  }

  const sunrise = searchAltitudeSafe(Astronomy.Body.Sun, observer, +1, sunset, 1.6, -18.0);
  if (!sunrise || sunrise.date <= sunset.date) {
    throw new Error("Could not find astronomical sunrise after sunset for this date/location.");
  }

  return { sunset, sunrise };
}

function sampleAltitudes(body, observer, startDate, endDate, stepMinutes, planetName) {
  const samples = [];
  const stepMs = stepMinutes * 60 * 1000;
  const startMs = startDate.getTime();
  const endMs = endDate.getTime();

  for (let ms = startMs; ms <= endMs; ms += stepMs) {
    const date = new Date(ms);
    const snapshot = calculateSnapshot(body, observer, date, planetName);
    samples.push({
      date,
      altitude: snapshot.hor.altitude,
      azimuth: snapshot.hor.azimuth,
      snapshot
    });
  }

  if (samples[samples.length - 1].date.getTime() !== endMs) {
    const date = new Date(endMs);
    const snapshot = calculateSnapshot(body, observer, date, planetName);
    samples.push({
      date,
      altitude: snapshot.hor.altitude,
      azimuth: snapshot.hor.azimuth,
      snapshot
    });
  }

  return samples;
}

function analyzeSamples(samples) {
  let maxSample = samples[0];

  for (const sample of samples) {
    if (sample.altitude > maxSample.altitude) {
      maxSample = sample;
    }
  }

  return { maxSample };
}

function findThresholdWindows(samples, threshold) {
  const windows = [];
  let inWindow = samples[0].altitude >= threshold;
  let start = inWindow ? samples[0].date : null;

  for (let i = 1; i < samples.length; i += 1) {
    const prev = samples[i - 1];
    const curr = samples[i];

    if (!inWindow && prev.altitude < threshold && curr.altitude >= threshold) {
      start = interpolateTime(prev, curr, threshold);
      inWindow = true;
    }

    if (inWindow && prev.altitude >= threshold && curr.altitude < threshold) {
      const end = interpolateTime(prev, curr, threshold);
      windows.push({ start, end });
      inWindow = false;
      start = null;
    }
  }

  if (inWindow && start) {
    windows.push({
      start,
      end: samples[samples.length - 1].date
    });
  }

  const totalMinutes = windows.reduce((sum, window) => {
    return sum + (window.end.getTime() - window.start.getTime()) / 60000;
  }, 0);

  return { windows, totalMinutes };
}

function interpolateTime(prev, curr, targetAltitude) {
  const t1 = prev.date.getTime();
  const t2 = curr.date.getTime();
  const a1 = prev.altitude;
  const a2 = curr.altitude;

  if (a1 === a2) {
    return new Date(t1);
  }

  const fraction = (targetAltitude - a1) / (a2 - a1);
  const clamped = Math.max(0, Math.min(1, fraction));
  return new Date(t1 + (t2 - t1) * clamped);
}

function selectBestWindow(windows, peakDate) {
  if (!windows.length) {
    return null;
  }

  const peakMs = peakDate.getTime();
  const containing = windows.find((w) => peakMs >= w.start.getTime() && peakMs <= w.end.getTime());
  if (containing) {
    return containing;
  }

  let best = windows[0];
  for (const w of windows) {
    if (w.end.getTime() - w.start.getTime() > best.end.getTime() - best.start.getTime()) {
      best = w;
    }
  }
  return best;
}

function renderSnapshot(snapshot) {
  dom.out.ra.textContent = formatRA(snapshot.equ.ra);
  dom.out.dec.textContent = formatDec(snapshot.equ.dec);
  dom.out.jd.textContent = snapshot.jd.toFixed(6);

  dom.out.alt.textContent = `${formatDegrees(snapshot.hor.altitude)} deg`;
  dom.out.az.textContent = `${formatDegrees(snapshot.hor.azimuth)} deg`;
  dom.out.above.textContent = snapshot.hor.altitude > 0 ? "Yes" : "No";

  const mag = snapshot.illumination && Number.isFinite(snapshot.illumination.mag) ? snapshot.illumination.mag.toFixed(2) : "--";
  const phaseAngle =
    snapshot.illumination && Number.isFinite(snapshot.illumination.phase_angle)
      ? `${snapshot.illumination.phase_angle.toFixed(2)} deg`
      : "--";
  const phaseFraction =
    snapshot.illumination && Number.isFinite(snapshot.illumination.phase_fraction)
      ? snapshot.illumination.phase_fraction.toFixed(4)
      : "--";
  const phasePercent =
    snapshot.illumination && Number.isFinite(snapshot.illumination.phase_fraction)
      ? `${(snapshot.illumination.phase_fraction * 100).toFixed(2)}%`
      : "--";

  dom.out.mag.textContent = mag;
  dom.out.phaseAngle.textContent = phaseAngle;
  dom.out.phaseFraction.textContent = phaseFraction;
  dom.out.phasePercent.textContent = phasePercent;
  dom.out.angularDiameter.textContent = Number.isFinite(snapshot.angularDiameter)
    ? `${snapshot.angularDiameter.toFixed(2)} arcsec`
    : "--";
}

function drawAltitudeChart(samples, threshold, maxSample) {
  const canvas = dom.chart;
  const ctx = canvas.getContext("2d");

  const dpr = window.devicePixelRatio || 1;
  const cssWidth = canvas.clientWidth;
  const cssHeight = canvas.clientHeight;

  canvas.width = Math.max(1, Math.floor(cssWidth * dpr));
  canvas.height = Math.max(1, Math.floor(cssHeight * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  ctx.clearRect(0, 0, cssWidth, cssHeight);

  const padding = { left: 44, right: 16, top: 14, bottom: 28 };
  const plotW = cssWidth - padding.left - padding.right;
  const plotH = cssHeight - padding.top - padding.bottom;

  const startMs = samples[0].date.getTime();
  const endMs = samples[samples.length - 1].date.getTime();
  const minAlt = Math.min(-20, Math.floor(Math.min(...samples.map((s) => s.altitude)) / 10) * 10);
  const maxAlt = 90;

  const xFor = (date) => {
    const ms = date.getTime();
    const ratio = (ms - startMs) / Math.max(1, endMs - startMs);
    return padding.left + ratio * plotW;
  };

  const yFor = (alt) => {
    const ratio = (alt - minAlt) / (maxAlt - minAlt);
    return padding.top + (1 - ratio) * plotH;
  };

  ctx.fillStyle = "rgba(5,10,20,0.9)";
  ctx.fillRect(padding.left, padding.top, plotW, plotH);

  ctx.strokeStyle = "rgba(145, 164, 212, 0.25)";
  ctx.lineWidth = 1;
  ctx.font = "11px Trebuchet MS";
  ctx.fillStyle = "#a8b4d2";

  for (let alt = Math.ceil(minAlt / 10) * 10; alt <= maxAlt; alt += 10) {
    const y = yFor(alt);
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(padding.left + plotW, y);
    ctx.stroke();
    ctx.fillText(`${alt}deg`, 4, y + 3);
  }

  for (let i = 0; i <= 6; i += 1) {
    const ratio = i / 6;
    const x = padding.left + ratio * plotW;
    const t = new Date(startMs + ratio * (endMs - startMs));

    ctx.beginPath();
    ctx.moveTo(x, padding.top);
    ctx.lineTo(x, padding.top + plotH);
    ctx.stroke();

    ctx.fillText(formatTimeLabel(t), x - 17, padding.top + plotH + 16);
  }

  if (threshold >= minAlt && threshold <= maxAlt) {
    const yThreshold = yFor(threshold);
    ctx.save();
    ctx.strokeStyle = "#ff9a7a";
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(padding.left, yThreshold);
    ctx.lineTo(padding.left + plotW, yThreshold);
    ctx.stroke();
    ctx.restore();
  }

  ctx.strokeStyle = "#7ed0ff";
  ctx.lineWidth = 2;
  ctx.beginPath();

  samples.forEach((sample, index) => {
    const x = xFor(sample.date);
    const y = yFor(sample.altitude);
    if (index === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }
  });

  ctx.stroke();

  if (maxSample) {
    const x = xFor(maxSample.date);
    const y = yFor(maxSample.altitude);
    ctx.fillStyle = "#8dffa9";
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fill();
  }
}

function buildObserver() {
  const latitude = Number(dom.latitude.value);
  const longitude = Number(dom.longitude.value);
  const elevation = Number(dom.elevation.value || 0);

  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
    throw new Error("Latitude must be a valid number between -90 and 90.");
  }

  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    throw new Error("Longitude must be a valid number between -180 and 180 (east positive).");
  }

  if (!Number.isFinite(elevation)) {
    throw new Error("Elevation must be a valid number.");
  }

  return new Astronomy.Observer(latitude, longitude, elevation);
}

function searchAltitudeSafe(body, observer, direction, startTime, limitDays, altitudeDegrees) {
  try {
    return Astronomy.SearchAltitude(body, observer, direction, startTime, limitDays, altitudeDegrees);
  } catch (_) {
    return null;
  }
}

function searchHourAngleSafe(body, observer, hourAngle, startTime, direction) {
  try {
    return Astronomy.SearchHourAngle(body, observer, hourAngle, startTime, direction);
  } catch (_) {
    return null;
  }
}

function astroTimeInRange(time, startDate, endDate) {
  if (!time || !time.date) {
    return null;
  }
  const eventMs = time.date.getTime();
  if (eventMs < startDate.getTime() || eventMs > endDate.getTime()) {
    return null;
  }
  return time;
}

function eventInRange(event, startDate, endDate) {
  if (!event || !event.time || !event.time.date) {
    return null;
  }
  const eventMs = event.time.date.getTime();
  if (eventMs < startDate.getTime() || eventMs > endDate.getTime()) {
    return null;
  }
  return event;
}

function angularDiameterArcsec(distanceAu, planetName) {
  if (!Number.isFinite(distanceAu) || distanceAu <= 0) {
    return null;
  }

  const info = PLANETS[planetName];
  if (!info || !Number.isFinite(info.diameterKm)) {
    return null;
  }

  const radiusKm = info.diameterKm / 2;
  const distanceKm = distanceAu * AU_KM;
  const radians = 2 * Math.atan2(radiusKm, distanceKm);
  return radians * ARCSEC_PER_RADIAN;
}

function parseLocalDateTime(dateStr, timeStr) {
  if (!dateStr) {
    throw new Error("Date is required.");
  }

  if (!timeStr) {
    throw new Error("Time is required.");
  }

  const normalizedTime = timeStr.length === 5 ? `${timeStr}:00` : timeStr;
  const date = new Date(`${dateStr}T${normalizedTime}`);

  if (Number.isNaN(date.getTime())) {
    throw new Error("Invalid local date/time input.");
  }

  return date;
}

function julianDate(date) {
  return date.getTime() / 86400000 + 2440587.5;
}

function formatRA(raHours) {
  const h = ((raHours % 24) + 24) % 24;
  const totalSeconds = Math.round(h * 3600);
  const hh = Math.floor(totalSeconds / 3600) % 24;
  const mm = Math.floor((totalSeconds % 3600) / 60);
  const ss = totalSeconds % 60;
  return `${pad2(hh)}:${pad2(mm)}:${pad2(ss)}`;
}

function formatDec(decDegrees) {
  const sign = decDegrees >= 0 ? "+" : "-";
  const abs = Math.abs(decDegrees);
  const totalArcSeconds = Math.round(abs * 3600);
  const dd = Math.floor(totalArcSeconds / 3600);
  const mm = Math.floor((totalArcSeconds % 3600) / 60);
  const ss = totalArcSeconds % 60;
  return `${sign}${pad2(dd)}:${pad2(mm)}:${pad2(ss)}`;
}

function formatDegrees(value) {
  return Number.isFinite(value) ? value.toFixed(2) : "--";
}

function formatDuration(minutes) {
  if (!Number.isFinite(minutes) || minutes <= 0) {
    return "0m";
  }
  const rounded = Math.round(minutes);
  const h = Math.floor(rounded / 60);
  const m = rounded % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function formatRange(start, end) {
  return `${formatLocalDateTime(start)} to ${formatLocalDateTime(end)}`;
}

function formatTransit(event) {
  if (!event || !event.time || !event.time.date) {
    return "--";
  }
  const alt = event.hor && Number.isFinite(event.hor.altitude) ? `, alt ${formatDegrees(event.hor.altitude)} deg` : "";
  return `${formatLocalDateTime(event.time.date)}${alt}`;
}

function formatAstroTime(value) {
  if (!value) {
    return "--";
  }

  if (value.time && value.time.date) {
    return formatLocalDateTime(value.time.date);
  }

  if (value.date) {
    return formatLocalDateTime(value.date);
  }

  return "--";
}

function formatDateInput(date) {
  const y = date.getFullYear();
  const m = pad2(date.getMonth() + 1);
  const d = pad2(date.getDate());
  return `${y}-${m}-${d}`;
}

function formatTimeInput(date) {
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function formatLocalDateTime(date) {
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  });
}

function formatTimeLabel(date) {
  return date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function setStatus(message) {
  dom.status.textContent = message;
}

function setError(message) {
  dom.error.textContent = message;
}

function setLocationStatus(message) {
  dom.locationStatus.textContent = message;
}

function showLoading(show) {
  dom.loading.classList.toggle("hidden", !show);
}

function clearOutputs() {
  const fields = Object.values(dom.out);
  fields.forEach((el) => {
    el.textContent = "--";
  });
  dom.nightSummary.classList.add("hidden");
  dom.chartWrap.classList.add("hidden");
  lastChartData = null;
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
