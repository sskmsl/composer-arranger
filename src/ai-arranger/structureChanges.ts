import type { ArrangementStructureChange } from "@/core/arrangementGeneration"
import type { ComposerProject } from "@/core/project"
import { SECTION_ROLE_LABELS, type Section } from "@/core/section"

function normalize(value: string): string {
  return value
    .replace(/[０-９]/g, (digit) => String.fromCharCode(digit.charCodeAt(0) - 0xfee0))
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/\s+/g, "")
}

interface SectionAlias {
  section: Section
  aliases: string[]
}

function aliasesForSections(sections: readonly Section[]): SectionAlias[] {
  const occurrences = new Map<string, Section[]>()
  for (const section of sections) {
    const list = occurrences.get(section.role) ?? []
    list.push(section)
    occurrences.set(section.role, list)
  }
  return sections.map((section) => {
    const peers = occurrences.get(section.role) ?? [section]
    const index = peers.findIndex((candidate) => candidate.id === section.id)
    const roleLabel = SECTION_ROLE_LABELS[section.role]
    const aliases = new Set([
      normalize(section.name),
      normalize(roleLabel),
      normalize(`${roleLabel}${index + 1}`),
      normalize(`${index + 1}回目の${roleLabel}`),
    ])
    if (index === peers.length - 1) {
      aliases.add(normalize(`最後の${roleLabel}`))
      aliases.add(normalize(`最終${roleLabel}`))
    }
    return {
      section,
      aliases: [...aliases].filter(Boolean).sort((left, right) => right.length - left.length),
    }
  })
}

function mentionedSections(clause: string, aliases: readonly SectionAlias[]): Section[] {
  const normalizedClause = normalize(clause)
  const matched = aliases
    .map(({ section, aliases: names }) => {
      const matchingNames = names.filter((name) => name.length >= 2 && normalizedClause.includes(name))
      const strongestName = matchingNames.sort((left, right) => right.length - left.length)[0]
      return {
        section,
        length: strongestName?.length ?? 0,
        position: strongestName ? normalizedClause.indexOf(strongestName) : -1,
      }
    })
    .filter((candidate) => candidate.length > 0)
  const strongestByRole = new Map<string, number>()
  for (const candidate of matched) {
    strongestByRole.set(
      candidate.section.role,
      Math.max(strongestByRole.get(candidate.section.role) ?? 0, candidate.length),
    )
  }
  return matched
    .filter((candidate) => candidate.length === strongestByRole.get(candidate.section.role))
    .sort((left, right) => left.position - right.position)
    .map(({ section }) => section)
}

function dedupe(changes: ArrangementStructureChange[]): ArrangementStructureChange[] {
  const seen = new Set<string>()
  return changes.filter((change) => {
    const key = JSON.stringify(change)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** 曲に実在するSectionへ名前・役割・出現順を解決できた指示だけを返す。 */
export function parseArrangementStructureChanges(
  project: ComposerProject,
  source: string,
): ArrangementStructureChange[] {
  const aliases = aliasesForSections(project.sections)
  const changes: ArrangementStructureChange[] = []
  const clauses = source.split(/[。\n；;、]/).map((value) => value.trim()).filter(Boolean)

  for (const clause of clauses) {
    const normalizedClause = normalize(clause)
    let targets = mentionedSections(clause, aliases)
    // 日本語ポップスで一般的な「2番」は、2回目のAメロから次のサビまでを指す。
    if (targets.length === 0 && normalizedClause.includes("2番")) {
      const verses = project.sections.filter((section) => section.role === "verse")
      const secondVerse = verses[1]
      if (secondVerse) {
        const startIndex = project.sections.findIndex((section) => section.id === secondVerse.id)
        const chorusIndex = project.sections.findIndex(
          (section, index) => index >= startIndex && ["chorus", "breakdown-chorus", "grand-chorus"].includes(section.role),
        )
        const endIndex = chorusIndex >= startIndex ? chorusIndex : startIndex
        targets = project.sections.slice(startIndex, endIndex + 1)
      }
    }
    if (targets.length === 0) continue

    const resize = normalizedClause.match(/(\d+)小節(?:に|へ)(?:する|変更|縮める|伸ばす|調整)?/)
    if (resize) {
      const lengthBars = Math.max(1, Math.min(512, Number(resize[1])))
      for (const target of targets) {
        changes.push({ kind: "resize-section", sectionId: target.id, sectionName: target.name, lengthBars })
      }
      continue
    }

    if (/(?:削除|なくす|無くす|カット|省く|外す)/.test(clause)) {
      for (const target of targets) {
        changes.push({ kind: "remove-section", sectionId: target.id, sectionName: target.name })
      }
      continue
    }

    const another = normalizedClause.match(/もう(\d+)回(?:繰り返|リピート|追加)/)
    const repeat = normalizedClause.match(/(\d+)回(?:繰り返|リピート)/)
    if (another || repeat || /もう一度|もう1回/.test(normalizedClause)) {
      const copies = another
        ? Number(another[1])
        : repeat
          ? Math.max(1, Number(repeat[1]) - 1)
          : 1
      // 「サビ」だけなら全サビを複製せず、曲中で最後に現れる対象を繰り返す。
      const target = targets[targets.length - 1]
      changes.push({
        kind: "duplicate-section",
        sectionId: target.id,
        sectionName: target.name,
        copies: Math.max(1, Math.min(4, copies)),
      })
      continue
    }

    const position = normalizedClause.includes("の前") || normalizedClause.includes("より前")
      ? "before"
      : normalizedClause.includes("の後") || normalizedClause.includes("より後")
        ? "after"
        : null
    if (position && targets.length >= 2) {
      const [target, anchor] = targets
      if (target.id !== anchor.id) {
        changes.push({
          kind: "move-section",
          sectionId: target.id,
          sectionName: target.name,
          anchorSectionId: anchor.id,
          anchorSectionName: anchor.name,
          position,
        })
      }
    }
  }

  return dedupe(changes)
}

export function arrangementStructureChangeLabel(change: ArrangementStructureChange): string {
  if (change.kind === "resize-section") return `${change.sectionName}を${change.lengthBars}小節に変更`
  if (change.kind === "remove-section") return `${change.sectionName}を削除`
  if (change.kind === "duplicate-section") return `${change.sectionName}を${change.copies}回追加`
  return `${change.sectionName}を${change.anchorSectionName}の${change.position === "before" ? "前" : "後"}へ移動`
}

export function arrangementStructureChangesFingerprint(
  changes: readonly ArrangementStructureChange[] | undefined,
): string {
  return JSON.stringify(changes ?? [])
}
