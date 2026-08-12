# Local patches

Changes to upstream's own files live here as patch files, applied while the
app is built and reverted right after. Nothing in this directory is ever
committed *into* upstream's files, which is the whole point: this branch adds
files and never edits theirs, so rebasing onto a new upstream can never
conflict, no matter how much they change.

If a patch stops applying because upstream rewrote that code, the build says
so, skips it, and carries on with upstream's behavior. An update never breaks
and never waits for you.

## Making one

Work in the repo as usual, then turn your change into a patch and reset the
tree:

```sh
git diff > patches/010-my-change.patch
git checkout -- .
```

Patches apply in filename order, so number them if one depends on another.
Keep each patch to one concern — a patch that touches five unrelated files is
five chances to stop applying.

## When a patch stops applying

Two good options, in order:

1. **Send it upstream.** A merged change needs no patch at all. Once it is in
   upstream, delete the file from here.
2. **Rewrite it** against the new code: apply what you can, redo the rest,
   regenerate the patch.

## What does not belong here

Anything that can live in a file upstream does not have (a new script, a new
workflow, a config file) belongs in the repo directly — patches are only for
editing files upstream owns.
