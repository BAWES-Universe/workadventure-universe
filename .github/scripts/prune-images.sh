#!/usr/bin/env bash
# Delete old dev builds from one GHCR package (#741).
#
# Only a version whose tags are ALL `universe-develop` or `universe-develop-<sha>` can be deleted,
# and only when it is not one of the newest $KEEP (the one tagged `universe-develop` itself is always kept). A version that carries any other tag
# (`universe`, `universe-<sha>`, `latest`) is a release and is never touched. Untagged versions
# are listed but never deleted: they can be the child manifests of a tagged image.
#
# Usage: prune-images.sh <owner> <package> <keep> <live: true|false>
set -euo pipefail

OWNER="$1"
PACKAGE="$2"
KEEP="$3"
LIVE="$4"

# A negative or non-numeric count would turn the slice below into "everything"
if ! [[ "$KEEP" =~ ^[0-9]+$ ]]; then
  echo "keep must be a whole number of dev builds, got: ${KEEP}" >&2
  exit 1
fi

VERSIONS=$(gh api --paginate "/orgs/${OWNER}/packages/container/${PACKAGE}/versions?per_page=100" | jq -s 'add // []')

TOTAL=$(jq 'length' <<<"$VERSIONS")
UNTAGGED=$(jq '[.[] | select((.metadata.container.tags // []) | length == 0)] | length' <<<"$VERSIONS")

# Newest first, so everything after the first $KEEP dev builds is old. The build that carries the `universe-develop`
# tag is the current one and is never deleted, whatever $KEEP is.
DELETE=$(jq -c --argjson keep "$KEEP" '
  [ .[]
    | select((.metadata.container.tags // []) | length > 0)
    | select((.metadata.container.tags // []) | index("universe-develop") | not)
    | select((.metadata.container.tags // []) | all(test("^universe-develop(-[0-9a-f]+)?$")))
  ]
  | sort_by(.created_at) | reverse
  | .[$keep:]
  | map({id, created_at, tags: .metadata.container.tags})
' <<<"$VERSIONS")

COUNT=$(jq 'length' <<<"$DELETE")
echo "${PACKAGE}: ${TOTAL} versions, ${UNTAGGED} untagged (kept), ${COUNT} old dev builds to delete (keeping the newest ${KEEP})"

jq -r '.[] | "  \(.id)  \(.created_at)  \(.tags | join(","))"' <<<"$DELETE"

if [ "$COUNT" -eq 0 ]; then
  exit 0
fi

if [ "$LIVE" != "true" ]; then
  echo "Dry run: nothing deleted. Set the repository variable PRUNE_IMAGES_LIVE to true to delete."
  exit 0
fi

jq -r '.[].id' <<<"$DELETE" | while read -r ID; do
  gh api --method DELETE "/orgs/${OWNER}/packages/container/${PACKAGE}/versions/${ID}"
  echo "  deleted ${ID}"
done
