---
name: platform
description: 산초 플랫폼 화면(일정·프로젝트·메일정리·메신저·회의·목표·공수·조직·결재·로드맵)의 데이터 파일 db/<컬렉션>.json 형식과 고치는 규칙. 주인이 "일정 잡아줘", "기안서 써줘", "메일 정리해줘", "OKR 갱신해" 하면 이 스킬을 따른다.
---

# 산초 플랫폼 데이터 (db/*.json)

플랫폼 화면은 `db/<컬렉션>.json` 파일을 읽어 그린다. 파일을 고치면 열려 있는 화면이 곧바로 따라 바뀐다(서버가 폴더를 감시한다).
파일 형식은 `{ "<id>": { …필드 } }` 이다. 배열이 아니다. 없는 파일은 `{}` 로 새로 만든다.

## 규칙
- id: 짧은 영문·숫자(예 `ev-0915a`, `pj-tank`). 기존 id 는 바꾸지 않는다.
- 날짜 `YYYY-MM-DD`, 시각 `HH:MM`, 시각 도장은 ISO 문자열(`new Date().toISOString()` 꼴). 숫자는 숫자로.
- 기존 문서를 고칠 때는 필요한 필드만 바꾸고 나머지(특히 `createdAt`, 모르는 필드)는 그대로 둔다. `updatedAt` 은 지금 시각으로.
- 고친 뒤 "왼쪽 <메뉴> 에서 보세요" 한 줄과 무엇을 넣었는지 요약한다.
- 사용자(담당자) id 는 `db/users.json` 의 키다. 주인은 `owner`. 이름을 들으면 users 에서 찾고, 없으면 새 사용자를 만들지 말고 이름을 `who`/`name` 필드에 글자로 넣는다.
- 프로젝트 id 는 `db/projects.json` 의 키. 프로젝트 공정표는 `wbs/<이름>.json` (wbs 스킬) 이고 프로젝트 문서의 `wbs` 필드가 그 이름이다.

## 컬렉션과 필드
| 파일 | 화면 | 필드 |
|---|---|---|
| `db/users.json` | 조직/권한 | `name, title(직급), dept, email, phone, role(super·exec·manager·member), active(true/false), color` |
| `db/depts.json` | 조직/권한 | `name, icon(이모지), li(lucide 아이콘 이름), order, lead(userId), memo` |
| `db/projects.json` | 프로젝트 | `code, name, client, pm(userId), members[], start, end, status(plan·active·hold·done), color, hidden, wbs(공정표 파일명), memo, progress` |
| `db/events.json` | 일정 | `title, date, time, endTime, endDate, allDay, category(회의·검사·마감·교육·출장·개인·기타), color(blue·green·orange·red·purple·gray), dept, projectId, location, attendees[], memo, source(user·sancho·google)` |
| `db/tasks.json` | 프로젝트 › 업무 보드 | `title, projectId, assignee(userId), due, priority(high·mid·low), status(todo·doing·review·done), memo, source` |
| `db/mail.json` | 메일정리 | `from, fromName, to, subject, date(ISO), category(업무·개인·뉴스레터·광고·알림), urgency(긴급·보통·낮음), summary, action, due, status(대기·처리·보류·무시), link, threadId, projectId, replyDraft` |
| `db/channels.json` | 메신저 | `name, type(notice·dept·project·group·dm), members[], dept, projectId, icon, pinned, lastRead{}` |
| `db/messages.json` | 메신저 | `channelId, userId, userName, text, ts(ISO), files[{name,path,size}]` — 산초가 알릴 게 있으면 `userId:"sancho", userName:"산초"` 로 채널에 글을 남긴다 |
| `db/rooms.json` | 회의실 | `name, capacity, equipment[], color, order` |
| `db/meetings.json` | 회의실·회의록 | `title, roomId, date, start, end, organizer, attendees[], agenda, status(예약·진행·완료·취소), projectId, minutes{topic, summary, agendas[{title, discussion, decision, actions[{text, who, due, done}]}]}, transcript, docPath` |
| `db/okrs.json` | 목표관리 | `scope(company·dept·personal), dept, ownerId, title, why, period, start, end, pctManual, milestones[{id, title, due, pct, who}], status(active·done·hold), parentId` — 진행률은 마일스톤 pct 평균 |
| `db/manday.json` | Manday Tracker | `date, userId, userName, projectId, projectCode, task, regular(정규 시간), overtime(야근 시간), md((정규+야근)/8), memo, raw` |
| `db/approvals.json` | 결재 | `title, type(general·purchase·quality·project·schedule-change·okr-change·leave·expense), drafterId, body(마크다운 본문), amount, due, projectId, attachments[{name,path}], approvalLine[{userId, name, role(검토·승인), status(waiting·pending·approved·rejected·skipped), note, at}], status(pending·approved·rejected·withdrawn), decisionNote` |
| `db/roadmap.json` | 로드맵·진척 | 문서 하나 `main`: `title, phases[{id, title, period, items[{id, text, status(todo·wip·done·hold·cancel), owner, due, at}]}]` |

## 자주 받는 지시 → 할 일
- "내일 3시에 ○○ 회의 잡아줘" → `db/events.json` 에 `{title, date, time:"15:00", category:"회의", color:"blue", source:"sancho"}` 추가. 회의실까지 말하면 `db/meetings.json` 에도 예약(`status:"예약"`) 추가.
- "메일 정리해줘" → 연결된 앱(Gmail) 도구가 켜져 있으면 오늘 받은 메일을 읽고 한 통에 한 문서씩 `db/mail.json` 에 넣는다(`category·urgency·summary·action` 을 채운다, 이미 있는 threadId 는 건너뛴다). 꺼져 있으면 주인에게 권한을 켜 달라고 말한다.
- "기안서 써줘 / 결재 올려줘" → `db/approvals.json` 에 `status:"pending"`, `drafterId:"owner"`, `body` 는 마크다운(목적·내용·금액·기간), `approvalLine` 은 주인이 말한 결재자(없으면 `[{userId:"owner", name:주인 이름, role:"승인", status:"pending"}]`).
- "OKR 만들어/갱신" → `db/okrs.json`. 마일스톤을 3~5개로 쪼개고 `pct` 는 말단만 적는다.
- "오늘 공수 기록: SJ456 탱크 외관검사 8시간 야근 2" → `db/manday.json` 에 `{date:오늘, userId:"owner", projectCode, task, regular:8, overtime:2, md:1.25, raw:원문}`.
- "회의록 정리해줘"(녹취 첨부) → `db/meetings.json` 의 해당 회의(없으면 새로) `minutes` 를 채우고 `status:"완료"`, 워드 파일을 파일함에 만들었으면 `docPath` 에 경로.
- "로드맵에 … 추가 / 완료 처리" → `db/roadmap.json` 의 `main.phases[].items[]` 를 고친다.
- "프로젝트 만들어" → `db/projects.json` 추가 + wbs 스킬로 `wbs/<이름>.json` 도 만들고 `wbs` 필드에 이름을 넣는다.
- "메신저에 알려줘 / 공지 올려줘" → `db/messages.json` 에 `userId:"sancho"` 로 글 추가(채널은 `db/channels.json` 에서 고르고, 없으면 `notice` 타입 `공지사항` 채널을 만든다).
