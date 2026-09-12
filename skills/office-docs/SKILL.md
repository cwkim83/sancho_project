---
name: office-docs
description: 엑셀(xlsx)·파워포인트(pptx)·워드(docx)·PDF 파일을 만들거나 고칠 때 쓴다. 주인이 "엑셀로 만들어줘", "발표자료(PPT) 만들어줘", "보고서 워드로 써줘", "이 PDF 읽어줘" 라고 하면 이 스킬을 따른다.
---

# 문서 만들기 (Windows PC · Python)

## 저장 위치와 이름
- 만든 파일은 산초 데이터 폴더 안 **`파일함/`** 에 저장한다(없으면 만든다). 대시보드가 그 파일을 카드로 보여 주인이 바로 연다.
- 파일명은 한글 가능. 날짜를 앞에 붙인다: `2026-09-13_품목현황.xlsx`.

## 도구
| 파일 | 라이브러리 | 요령 |
|---|---|---|
| 엑셀 .xlsx | `openpyxl` | 머리글 굵게+연한 채우기, 열 너비는 글자 수+2, 숫자는 숫자형으로(문자열 금지), 합계는 `=SUM()` 같은 수식으로, 틀 고정 `ws.freeze_panes = 'A2'` |
| 파워포인트 .pptx | `python-pptx` | 16:9(`prs.slide_width = Inches(13.333)`, `slide_height = Inches(7.5)`), 슬라이드마다 제목 한 줄 + 핵심 3~5줄, 표는 `shapes.add_table`, 글꼴 맑은 고딕 |
| 워드 .docx | `python-docx` | 제목(Heading 1) → 소제목(Heading 2) → 본문, 표는 `style='Table Grid'` |
| PDF 읽기 | `pdfplumber` (없으면 `pypdf`) | 표는 `page.extract_tables()` |
| PDF 만들기 | `reportlab` | 간단한 것만. 복잡하면 워드로 만들고 주인이 PDF 로 저장하게 안내 |

- 패키지가 없으면 먼저 `python -m pip install openpyxl python-pptx python-docx pdfplumber` 를 실행한다. 명령 실행 권한이 꺼져 있으면 주인에게 권한 메뉴에서 "명령 실행 허용"을 켜달라고 말한다.
- 스크립트는 `파일함/_make_*.py` 처럼 임시로 쓰고, 끝나면 지운다(파일함엔 결과물만 남긴다).

## 끝난 뒤
- 파일 경로를 알려주고 한 줄 요약: 엑셀은 시트·행 수, PPT 는 슬라이드 수, 워드는 쪽수/절 수.
- 주인이 고치라고 하면 같은 파일을 열어 고친다(새 파일을 만들지 않는다).
