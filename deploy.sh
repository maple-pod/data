#!/usr/bin/env sh

set -e

cd dist

git init
git add -A
git commit -m 'deploy'

git push -f https://github.com/maple-pod/data.git master:gh-pages

cd -