"use strict";

const state = {
  allRepositories: [],
  searchQuery: "",
  selectedLanguage: "all",
  sortBy: "updated_at",
};

const elements = {
  form: document.getElementById("search-form"),
  usernameInput: document.getElementById("username-input"),
  submitButton: document.getElementById("submit-button"),
  loadingText: document.getElementById("loading-text"),
  errorBox: document.getElementById("error-box"),
  summarySection: document.getElementById("summary-section"),
  summaryGrid: document.getElementById("summary-grid"),
  controlsSection: document.getElementById("controls-section"),
  repositoriesSection: document.getElementById("repositories-section"),
  repositoriesCount: document.getElementById("repositories-count"),
  repositoriesList: document.getElementById("repositories-list"),
  repoSearchInput: document.getElementById("repo-search-input"),
  languageFilter: document.getElementById("language-filter"),
  sortSelect: document.getElementById("sort-select"),
};

elements.form.addEventListener("submit", handleSubmit);
elements.repoSearchInput.addEventListener("input", handleSearch);
elements.languageFilter.addEventListener("change", (event) => {
  state.selectedLanguage = event.target.value;
  renderRepositories(applyFiltersAndSorting());
});
elements.sortSelect.addEventListener("change", (event) => {
  state.sortBy = event.target.value;
  renderRepositories(applyFiltersAndSorting());
});

async function handleSubmit(event) {
  event.preventDefault();

  const username = elements.usernameInput.value.trim();

  if (!username) {
    showError("Введите имя пользователя GitHub.");
    hideDataSections();
    return;
  }

  if (!isValidGitHubUsername(username)) {
    showError(
      "Некорректный username. Используйте 1-39 символов: латинские буквы, цифры и дефис. Username не должен начинаться или заканчиваться дефисом."
    );
    hideDataSections();
    return;
  }

  showError("");
  setLoading(true);

  try {
    const repositories = await fetchRepositories(username);
    const normalizedRepositories = repositories.map(normalizeRepository);

    if (normalizedRepositories.length === 0) {
      const error = new Error("У пользователя нет публичных репозиториев.");
      error.code = "NO_PUBLIC_REPOSITORIES";
      throw error;
    }

    state.allRepositories = normalizedRepositories;
    state.searchQuery = "";
    state.selectedLanguage = "all";
    state.sortBy = "updated_at";

    elements.repoSearchInput.value = "";
    elements.sortSelect.value = "updated_at";

    const summary = calculateSummary(state.allRepositories);
    renderSummary(summary);
    renderLanguageFilter(state.allRepositories);
    renderRepositories(applyFiltersAndSorting());
    showDataSections();
  } catch (error) {
    hideDataSections();
    showError(resolveErrorMessage(error));
  } finally {
    setLoading(false);
  }
}

function isValidGitHubUsername(username) {
  if (username.length < 1 || username.length > 39) {
    return false;
  }

  if (!/^[A-Za-z0-9-]+$/.test(username)) {
    return false;
  }

  if (username.startsWith("-") || username.endsWith("-")) {
    return false;
  }

  return true;
}

async function fetchRepositories(username) {
  const url = `https://api.github.com/users/${encodeURIComponent(
    username
  )}/repos?per_page=100&sort=updated`;

  let response;
  try {
    response = await fetch(url, {
      headers: {
        Accept: "application/vnd.github+json",
      },
    });
  } catch (error) {
    const networkError = new Error("GitHub API недоступен.");
    networkError.code = "API_UNAVAILABLE";
    throw networkError;
  }

  if (response.status === 404) {
    const notFoundError = new Error("Пользователь не найден.");
    notFoundError.code = "USER_NOT_FOUND";
    throw notFoundError;
  }

  if (response.status === 403) {
    const remaining = response.headers.get("X-RateLimit-Remaining");
    if (remaining === "0") {
      const rateLimitError = new Error("Превышен лимит запросов GitHub API.");
      rateLimitError.code = "RATE_LIMIT";
      throw rateLimitError;
    }
  }

  if (response.status >= 500) {
    const serverError = new Error("GitHub API временно недоступен.");
    serverError.code = "API_UNAVAILABLE";
    throw serverError;
  }

  if (!response.ok) {
    const unknownHttpError = new Error("Ошибка при обращении к GitHub API.");
    unknownHttpError.code = "API_ERROR";
    throw unknownHttpError;
  }

  let data;
  try {
    data = await response.json();
  } catch (error) {
    const parseError = new Error("Неожиданный формат ответа от GitHub API.");
    parseError.code = "UNEXPECTED_FORMAT";
    throw parseError;
  }

  if (!Array.isArray(data)) {
    const formatError = new Error("Неожиданный формат ответа от GitHub API.");
    formatError.code = "UNEXPECTED_FORMAT";
    throw formatError;
  }

  return data;
}

function normalizeRepository(repository) {
  if (
    !repository ||
    typeof repository !== "object" ||
    typeof repository.name !== "string" ||
    typeof repository.html_url !== "string"
  ) {
    const formatError = new Error("Неожиданный формат репозитория.");
    formatError.code = "UNEXPECTED_FORMAT";
    throw formatError;
  }

  const updatedAtRaw = typeof repository.updated_at === "string" ? repository.updated_at : "";
  const updatedDate = updatedAtRaw ? new Date(updatedAtRaw) : null;
  const updatedAtTimestamp =
    updatedDate && !Number.isNaN(updatedDate.getTime()) ? updatedDate.getTime() : 0;

  return {
    name: repository.name,
    description: repository.description || "Описание отсутствует",
    language: repository.language || "Не указан",
    stargazersCount: Number.isFinite(repository.stargazers_count) ? repository.stargazers_count : 0,
    forksCount: Number.isFinite(repository.forks_count) ? repository.forks_count : 0,
    updatedAt: updatedAtRaw,
    updatedAtFormatted: updatedAtTimestamp ? formatDate(updatedDate) : "Дата не указана",
    updatedAtTimestamp,
    htmlUrl: repository.html_url,
  };
}

function calculateSummary(repositories) {
  const summary = {
    totalRepositories: repositories.length,
    totalStars: 0,
    totalForks: 0,
    topLanguages: [],
  };

  const languageCounter = {};

  repositories.forEach((repository) => {
    summary.totalStars += repository.stargazersCount;
    summary.totalForks += repository.forksCount;
    languageCounter[repository.language] = (languageCounter[repository.language] || 0) + 1;
  });

  summary.topLanguages = Object.entries(languageCounter)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([language, count]) => `${language} (${formatNumber(count)})`);

  return summary;
}

function renderSummary(summary) {
  elements.summaryGrid.innerHTML = "";

  const cards = [
    { title: "Всего репозиториев", value: formatNumber(summary.totalRepositories) },
    { title: "Суммарно stars", value: formatNumber(summary.totalStars) },
    { title: "Суммарно forks", value: formatNumber(summary.totalForks) },
    {
      title: "Топ языков",
      value: summary.topLanguages.length > 0 ? summary.topLanguages.join(", ") : "Нет данных",
    },
  ];

  cards.forEach((cardData) => {
    const card = document.createElement("article");
    card.className = "summary-card";

    const title = document.createElement("p");
    title.className = "summary-card-title";
    title.textContent = cardData.title;

    const value = document.createElement("p");
    value.className = "summary-card-value";
    value.textContent = cardData.value;

    card.appendChild(title);
    card.appendChild(value);
    elements.summaryGrid.appendChild(card);
  });
}

function renderRepositories(repositories) {
  elements.repositoriesList.innerHTML = "";
  elements.repositoriesCount.textContent = `Показано ${formatNumber(
    repositories.length
  )} из ${formatNumber(state.allRepositories.length)} репозиториев.`;

  if (repositories.length === 0) {
    const emptyText = document.createElement("p");
    emptyText.className = "small-note";
    emptyText.textContent = "По текущим фильтрам репозитории не найдены.";
    elements.repositoriesList.appendChild(emptyText);
    return;
  }

  repositories.forEach((repository) => {
    const card = document.createElement("article");
    card.className = "repo-card";

    const title = document.createElement("h3");
    title.className = "repo-title";
    title.textContent = repository.name;

    const description = document.createElement("p");
    description.className = "repo-description";
    description.textContent = repository.description;

    const meta = document.createElement("div");
    meta.className = "repo-meta";

    const language = document.createElement("span");
    language.textContent = `Язык: ${repository.language}`;

    const stars = document.createElement("span");
    stars.textContent = `Stars: ${formatNumber(repository.stargazersCount)}`;

    const forks = document.createElement("span");
    forks.textContent = `Forks: ${formatNumber(repository.forksCount)}`;

    const updated = document.createElement("span");
    updated.textContent = `Обновлён: ${repository.updatedAtFormatted}`;

    meta.appendChild(language);
    meta.appendChild(stars);
    meta.appendChild(forks);
    meta.appendChild(updated);

    const link = document.createElement("a");
    link.className = "repo-link";
    link.href = repository.htmlUrl;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = "Открыть репозиторий";

    card.appendChild(title);
    card.appendChild(description);
    card.appendChild(meta);
    card.appendChild(link);
    elements.repositoriesList.appendChild(card);
  });
}

function renderLanguageFilter(repositories) {
  const languages = new Set();
  repositories.forEach((repository) => {
    languages.add(repository.language);
  });

  const sortedLanguages = Array.from(languages).sort((a, b) => a.localeCompare(b));

  elements.languageFilter.innerHTML = "";

  const defaultOption = document.createElement("option");
  defaultOption.value = "all";
  defaultOption.textContent = "Все языки";
  elements.languageFilter.appendChild(defaultOption);

  sortedLanguages.forEach((language) => {
    const option = document.createElement("option");
    option.value = language;
    option.textContent = language;
    elements.languageFilter.appendChild(option);
  });

  elements.languageFilter.value = "all";
}

function showError(message) {
  if (!message) {
    elements.errorBox.textContent = "";
    elements.errorBox.classList.add("hidden");
    return;
  }

  elements.errorBox.textContent = message;
  elements.errorBox.classList.remove("hidden");
}

function setLoading(isLoading) {
  elements.submitButton.disabled = isLoading;
  elements.usernameInput.disabled = isLoading;
  elements.loadingText.classList.toggle("hidden", !isLoading);
}

function handleSearch(event) {
  state.searchQuery = event.target.value.trim().toLowerCase();
  renderRepositories(applyFiltersAndSorting());
}

function applyFiltersAndSorting() {
  const filtered = state.allRepositories.filter((repository) => {
    const languageMatches =
      state.selectedLanguage === "all" || repository.language === state.selectedLanguage;
    const searchMatches = repository.name.toLowerCase().includes(state.searchQuery);
    return languageMatches && searchMatches;
  });

  filtered.sort((a, b) => {
    if (state.sortBy === "stars") {
      return b.stargazersCount - a.stargazersCount;
    }

    if (state.sortBy === "forks") {
      return b.forksCount - a.forksCount;
    }

    return b.updatedAtTimestamp - a.updatedAtTimestamp;
  });

  return filtered;
}

function showDataSections() {
  elements.summarySection.classList.remove("hidden");
  elements.controlsSection.classList.remove("hidden");
  elements.repositoriesSection.classList.remove("hidden");
}

function hideDataSections() {
  elements.summarySection.classList.add("hidden");
  elements.controlsSection.classList.add("hidden");
  elements.repositoriesSection.classList.add("hidden");
}

function resolveErrorMessage(error) {
  switch (error.code) {
    case "USER_NOT_FOUND":
      return "Пользователь не найден. Проверьте корректность username.";
    case "API_UNAVAILABLE":
      return "GitHub API недоступен. Попробуйте позже.";
    case "RATE_LIMIT":
      return "Превышен лимит запросов GitHub API. Подождите и повторите попытку.";
    case "UNEXPECTED_FORMAT":
      return "Получен неожиданный формат ответа от GitHub API.";
    case "NO_PUBLIC_REPOSITORIES":
      return "У пользователя нет публичных репозиториев.";
    default:
      return error && error.message ? error.message : "Произошла непредвиденная ошибка.";
  }
}

function formatDate(date) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatNumber(value) {
  return new Intl.NumberFormat("ru-RU").format(value);
}
