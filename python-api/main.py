import argparse
import json
import re
import sys
from collections import Counter
from datetime import datetime
from pathlib import Path
from typing import Any

import requests

API_URL_TEMPLATE = "https://api.github.com/users/{username}/repos?per_page=100&sort=updated"
USERNAME_PATTERN = re.compile(r"^[A-Za-z0-9-]{1,39}$")


class GitHubActivityError(Exception):
    """Raised for expected application errors with user-friendly messages."""


def positive_int(value: str) -> int:
    try:
        parsed = int(value)
    except ValueError as error:
        raise argparse.ArgumentTypeError("--limit должен быть целым числом.") from error

    if parsed < 1:
        raise argparse.ArgumentTypeError("--limit должен быть больше или равен 1.")

    return parsed


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Получение статистики публичных репозиториев GitHub пользователя."
    )
    parser.add_argument("--username", required=True, help="GitHub username")
    parser.add_argument(
        "--sort",
        choices=["stars", "forks", "updated_at"],
        default="stars",
        help="Поле сортировки репозиториев",
    )
    parser.add_argument(
        "--limit",
        type=positive_int,
        default=10,
        help="Максимальное количество репозиториев в выводе",
    )
    parser.add_argument(
        "--output",
        default="output/repos.json",
        help="Путь к JSON-файлу для сохранения результата",
    )
    return parser.parse_args()


def is_valid_github_username(username: str) -> bool:
    if not USERNAME_PATTERN.fullmatch(username):
        return False
    if username.startswith("-") or username.endswith("-"):
        return False
    return True


def fetch_repositories(username: str) -> list[dict[str, Any]]:
    url = API_URL_TEMPLATE.format(username=username)

    try:
        response = requests.get(
            url,
            headers={"Accept": "application/vnd.github+json"},
            timeout=15,
        )
    except requests.RequestException as error:
        raise GitHubActivityError("GitHub API недоступен или произошла сетевая ошибка.") from error

    if response.status_code == 404:
        raise GitHubActivityError("Пользователь не найден (HTTP 404).")

    if response.status_code == 403 and response.headers.get("X-RateLimit-Remaining") == "0":
        raise GitHubActivityError("Превышен лимит запросов GitHub API (HTTP 403).")

    if response.status_code >= 500:
        raise GitHubActivityError("GitHub API временно недоступен.")

    if not response.ok:
        raise GitHubActivityError(
            f"Ошибка при обращении к GitHub API: HTTP {response.status_code}."
        )

    try:
        data = response.json()
    except ValueError as error:
        raise GitHubActivityError("Ответ GitHub API не является корректным JSON.") from error

    if not isinstance(data, list):
        raise GitHubActivityError("Неожиданный формат ответа GitHub API.")

    return data


def normalize_repository(repository: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(repository, dict):
        raise GitHubActivityError("Неожиданный формат данных репозитория.")

    name = repository.get("name")
    url = repository.get("html_url")

    if not isinstance(name, str) or not isinstance(url, str):
        raise GitHubActivityError("Неожиданный формат данных репозитория.")

    updated_at = repository.get("updated_at")
    if not isinstance(updated_at, str):
        updated_at = ""

    stars_raw = repository.get("stargazers_count")
    forks_raw = repository.get("forks_count")

    stars = stars_raw if isinstance(stars_raw, int) else 0
    forks = forks_raw if isinstance(forks_raw, int) else 0

    return {
        "name": name,
        "description": repository.get("description") or "Описание отсутствует",
        "language": repository.get("language") or "Не указан",
        "stars": stars,
        "forks": forks,
        "updated_at": updated_at,
        "url": url,
    }


def updated_at_sort_key(repository: dict[str, Any]) -> float:
    updated_at = repository.get("updated_at", "")
    if not isinstance(updated_at, str) or not updated_at:
        return 0.0

    try:
        return datetime.fromisoformat(updated_at.replace("Z", "+00:00")).timestamp()
    except ValueError:
        return 0.0


def sort_repositories(repositories: list[dict[str, Any]], sort_by: str) -> list[dict[str, Any]]:
    if sort_by == "stars":
        return sorted(repositories, key=lambda repo: repo["stars"], reverse=True)

    if sort_by == "forks":
        return sorted(repositories, key=lambda repo: repo["forks"], reverse=True)

    return sorted(repositories, key=updated_at_sort_key, reverse=True)


def calculate_summary(
    username: str,
    repositories: list[dict[str, Any]],
    sort_by: str,
    limit: int,
) -> dict[str, Any]:
    total_stars = sum(repo["stars"] for repo in repositories)
    total_forks = sum(repo["forks"] for repo in repositories)

    language_counter: Counter[str] = Counter(repo["language"] for repo in repositories)
    top_languages = [
        {"language": language, "count": count}
        for language, count in language_counter.most_common(5)
    ]

    return {
        "username": username,
        "total_repositories": len(repositories),
        "total_stars": total_stars,
        "total_forks": total_forks,
        "top_languages": top_languages,
        "sorted_by": sort_by,
        "limit": limit,
    }


def save_result(output_path: str, result: dict[str, Any]) -> None:
    path = Path(output_path)
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("w", encoding="utf-8") as file:
            json.dump(result, file, ensure_ascii=False, indent=2)
    except OSError as error:
        raise GitHubActivityError(
            f"Не удалось сохранить результат в файл: {output_path}"
        ) from error


def format_number(value: int) -> str:
    return f"{value:,}".replace(",", " ")


def format_datetime(value: str) -> str:
    if not value:
        return "Дата не указана"
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return dt.strftime("%d.%m.%Y %H:%M")
    except ValueError:
        return value


def print_result(summary: dict[str, Any], repositories: list[dict[str, Any]], output_path: str) -> None:
    print("GitHub Activity Monitor")
    print("=" * 60)
    print(f"Пользователь: {summary['username']}")
    print(f"Всего публичных репозиториев: {format_number(summary['total_repositories'])}")
    print(f"Суммарно stars: {format_number(summary['total_stars'])}")
    print(f"Суммарно forks: {format_number(summary['total_forks'])}")
    print(f"Сортировка: {summary['sorted_by']}")
    print(f"Лимит в выдаче: {summary['limit']}")

    if summary["top_languages"]:
        languages = ", ".join(
            f"{item['language']} ({format_number(item['count'])})"
            for item in summary["top_languages"]
        )
    else:
        languages = "Нет данных"
    print(f"Топ языков: {languages}")

    print("\nРепозитории:")
    for index, repository in enumerate(repositories, start=1):
        print(f"{index}. {repository['name']}")
        print(f"   Описание: {repository['description']}")
        print(f"   Язык: {repository['language']}")
        print(f"   Stars: {format_number(repository['stars'])}")
        print(f"   Forks: {format_number(repository['forks'])}")
        print(f"   Обновлен: {format_datetime(repository['updated_at'])}")
        print(f"   Ссылка: {repository['url']}")

    print(f"\nРезультат сохранен в файл: {output_path}")


def main() -> int:
    args = parse_args()
    username = args.username.strip()

    try:
        if not is_valid_github_username(username):
            raise GitHubActivityError(
                "Некорректный username GitHub. Допустимы 1-39 символов: латинские буквы, цифры и дефис. Username не должен начинаться или заканчиваться дефисом."
            )

        raw_repositories = fetch_repositories(username)
        normalized_repositories = [normalize_repository(repo) for repo in raw_repositories]

        if not normalized_repositories:
            raise GitHubActivityError("У пользователя нет публичных репозиториев.")

        sorted_repositories = sort_repositories(normalized_repositories, args.sort)
        limited_repositories = sorted_repositories[: args.limit]

        summary = calculate_summary(
            username=username,
            repositories=normalized_repositories,
            sort_by=args.sort,
            limit=args.limit,
        )

        result = {
            "summary": summary,
            "repositories": limited_repositories,
        }

        save_result(args.output, result)
        print_result(summary, limited_repositories, args.output)
    except GitHubActivityError as error:
        print(f"Ошибка: {error}")
        return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())
