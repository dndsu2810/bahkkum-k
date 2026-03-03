// 3. 주간 평가 데이터 (동적으로 표와 분석을 구성하기 위한 데이터 소스)
// const weeklyEvaluationData = [
//     { week: '1주차', unit: '분수와 소수', score: 90, wrongQuestions: [4] },
//     { week: '2주차', unit: '분수와 소수', score: 85, wrongQuestions: [7, 12] },
//     { week: '3주차', unit: '도형의 넓이', score: 70, wrongQuestions: [3, 8, 14, 15] },
//     { week: '4주차', unit: '규칙 찾기', score: 95, wrongQuestions: [9] }
// ];

// 전역 차트 객체 (재렌더링 시 파괴용)
let scoreChartInstance = null;
let wrongNoteChartInstance = null;
let currentStudentId = 'kim';

document.addEventListener("DOMContentLoaded", () => {
    // 초기 렌더링
    renderAll(currentStudentId);

    // 학생 변경 이벤트
    document.getElementById("studentSelect").addEventListener("change", (e) => {
        currentStudentId = e.target.value;
        renderAll(currentStudentId);
    });

    // 전역 이벤트 리스너 바인딩 (최초 1회)
    setupGlobalEventListeners();
});

function setupGlobalEventListeners() {
    // 달력 이전/다음 달 버튼 이벤트
    document.getElementById("prevMonth").addEventListener("click", () => changeMonth(-1));
    document.getElementById("nextMonth").addEventListener("click", () => changeMonth(1));

    // 학생 추가 버튼 이벤트
    document.getElementById("addStudentBtn").addEventListener("click", () => {
        const newName = prompt("추가할 학생의 이름을 입력하세요:");
        if (!newName || newName.trim() === "") return;

        const newId = 'student_' + Date.now();

        // 새 학생 데이터 기본 템플릿 생성
        studentData[newId] = {
            name: newName.trim(),
            scores: { last: 0, current: 0 },
            wrongNotes: { total: 0, completed: 0 },
            habits: { skipped: 0, rushed: 0, unread: 0, mistake: 0 },
            evaluations: [
                { week: '1주차', unit: '단원명 입력', score: 0, wrongQuestions: [] },
                { week: '2주차', unit: '단원명 입력', score: 0, wrongQuestions: [] }
            ],
            attendance: {},
            descriptive: [
                { unit: '단원명 입력', thisAns: 0, thisTotal: 10, lastAns: 0, lastTotal: 10 }
            ],
            comment: "선생님 코멘트를 입력해주세요."
        };

        // select option 추가
        const select = document.getElementById("studentSelect");
        const option = document.createElement("option");
        option.value = newId;
        option.textContent = newName.trim();
        select.appendChild(option);

        // 해당 학생으로 즉시 변경
        select.value = newId;
        currentStudentId = newId;
        renderAll(currentStudentId);
    });

    // 학생 삭제 버튼 이벤트
    document.getElementById("deleteStudentBtn").addEventListener("click", () => {
        const select = document.getElementById("studentSelect");
        if (select.options.length <= 1) {
            alert("최소 1명의 학생은 남아있어야 합니다.");
            return;
        }

        const studentName = studentData[currentStudentId].name;
        if (confirm(`정말 '${studentName}' 학생의 데이터를 삭제하시겠습니까?`)) {
            // 데이터 삭제
            delete studentData[currentStudentId];

            // 옵션 삭제
            const optionToRemove = select.querySelector(`option[value="${currentStudentId}"]`);
            if (optionToRemove) select.removeChild(optionToRemove);

            // 다른 학생으로 포커스 이동
            currentStudentId = select.options[0].value;
            select.value = currentStudentId;
            renderAll(currentStudentId);
        }
    });

    // 로고 업로드 이벤트
    const logoContainer = document.getElementById('logoContainer');
    const logoInput = document.getElementById('logoInput');
    const academyLogo = document.getElementById('academyLogo');

    logoContainer.addEventListener('click', () => {
        logoInput.click();
    });

    logoInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = function (event) {
                academyLogo.src = event.target.result;
            }
            reader.readAsDataURL(file);
        }
    });

    // 성적 데이터 직접 수정 바인딩 (고정 요소이므로 최초 1회만)
    ['editLastMonth', 'editThisMonth'].forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('blur', (e) => {
            let num = parseInt(e.target.textContent.replace(/[^0-9]/g, ''), 10);
            if (!isNaN(num)) {
                if (id === 'editLastMonth') studentData[currentStudentId].scores.last = num;
                else studentData[currentStudentId].scores.current = num;
                renderScoreChart(studentData[currentStudentId].scores);
            }
        });
        el.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } });
    });

    // 오답노트 데이터 직접 수정 바인딩 (고정 요소이므로 최초 1회만)
    ['editWrongCompleted', 'editWrongTotal'].forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('blur', (e) => {
            let num = parseInt(e.target.textContent.replace(/[^0-9]/g, ''), 10);
            if (!isNaN(num)) {
                if (id === 'editWrongCompleted') studentData[currentStudentId].wrongNotes.completed = num;
                else studentData[currentStudentId].wrongNotes.total = num;
                renderWrongNoteChart(studentData[currentStudentId].wrongNotes);
            }
        });
        el.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } });
    });

    // 이미지 저장 버튼 이벤트
    document.getElementById("downloadBtn").addEventListener("click", downloadReportAsImage);
}

function renderAll(studentId) {
    const student = studentData[studentId];
    if (!student) return;

    // 헤더 이름 & 취약점 분석 제목 업데이트
    document.getElementById("displayStudentName").textContent = student.name;
    document.getElementById("analysisTitleName").textContent = student.name + " 학생";

    // 선생님 코멘트 업데이트
    document.getElementById("teacherComment").innerHTML = `<p>${student.comment}</p>`;

    // 1. 테이블 렌더링
    renderTable(student.evaluations);

    // 서술형 테이블 렌더링
    renderDescriptiveTable(student.descriptive);

    // 2. 데이터 분석하여 취약점 도출
    analyzeDataAndRender(student.evaluations);

    // 3. 차트 컴포넌트 렌더링 (동적 성적 추이 & 오답노트)
    renderScoreChart(student.scores);
    renderWrongNoteChart(student.wrongNotes);

    // 4. 습관 리스트 렌더링
    renderHabits(student.habits);

    // 5. 달력 렌더링 (학생별 출결 데이터)
    currentYear = 2026;
    currentMonth = 3;
    renderCalendar(currentYear, currentMonth, student.attendance);
}

// 학생별 목업 데이터
const studentData = {
    'kim': {
        name: '김철수',
        scores: [
            { month: '1월', score: null }, { month: '2월', score: 82 }, { month: '3월', score: 85 },
            { month: '4월', score: null }, { month: '5월', score: null }, { month: '6월', score: null },
            { month: '7월', score: null }, { month: '8월', score: null }, { month: '9월', score: null },
            { month: '10월', score: null }, { month: '11월', score: null }, { month: '12월', score: null }
        ],
        wrongNotes: { total: 22, completed: 19 },
        habits: { skipped: 6, rushed: 0, unread: 10, mistake: 12 },
        evaluations: [
            { week: '1주차', unit: '분수와 소수', score: 90, wrongQuestions: [4] },
            { week: '2주차', unit: '분수와 소수', score: 85, wrongQuestions: [7, 12] },
            { week: '3주차', unit: '도형의 넓이', score: 70, wrongQuestions: [3, 8, 14, 15] },
            { week: '4주차', unit: '규칙 찾기', score: 95, wrongQuestions: [9] }
        ],
        attendance: {
            '2026-03-02': 'present', '2026-03-04': 'present', '2026-03-09': 'present',
            '2026-03-11': 'late', '2026-03-16': 'absent', '2026-03-18': 'makeup',
            '2026-03-23': 'present', '2026-03-25': 'present', '2026-03-30': 'present'
        },
        descriptive: [
            { unit: '분수와 소수', thisAns: 8, thisTotal: 10, lastAns: 6, lastTotal: 10 },
            { unit: '도형의 넓이', thisAns: 7, thisTotal: 10, lastAns: 7, lastTotal: 10 }
        ],
        comment: "철수는 이번 달 <strong>'소수의 나눗셈'</strong> 단원에서 큰 성장을 보였습니다. 수업 시간에도 집중도가 매우 높으며 어려운 문제에도 끈기 있게 도전하는 모습이 칭찬할 만합니다. 다만 이전 단원인 <strong>'도형의 넓이'</strong> 파트에서 간혹 단순 계산 실수나 개념 혼동이 보이니, 다음 달 초에는 해당 내용을 복습하는 시간을 조금 더 늘리면 완벽할 것 같습니다."
    },
    'lee': {
        name: '이영희',
        scores: [
            { month: '1월', score: 90 }, { month: '2월', score: 92 }, { month: '3월', score: 98 },
            { month: '4월', score: null }, { month: '5월', score: null }, { month: '6월', score: null },
            { month: '7월', score: null }, { month: '8월', score: null }, { month: '9월', score: null },
            { month: '10월', score: null }, { month: '11월', score: null }, { month: '12월', score: null }
        ],
        wrongNotes: { total: 15, completed: 15 },
        habits: { skipped: 0, rushed: 1, unread: 2, mistake: 3 },
        evaluations: [
            { week: '1주차', unit: '분수와 소수', score: 100, wrongQuestions: [] },
            { week: '2주차', unit: '분수와 소수', score: 95, wrongQuestions: [12] },
            { week: '3주차', unit: '도형의 넓이', score: 100, wrongQuestions: [] },
            { week: '4주차', unit: '규칙 찾기', score: 95, wrongQuestions: [5] }
        ],
        attendance: {
            '2026-03-02': 'present', '2026-03-04': 'present', '2026-03-09': 'present',
            '2026-03-11': 'present', '2026-03-16': 'present', '2026-03-18': 'present',
            '2026-03-23': 'present', '2026-03-25': 'present', '2026-03-30': 'present'
        },
        descriptive: [
            { unit: '분수와 소수', thisAns: 10, thisTotal: 10, lastAns: 9, lastTotal: 10 },
            { unit: '도형의 넓이', thisAns: 10, thisTotal: 10, lastAns: 8, lastTotal: 10 }
        ],
        comment: "영희는 이번 달 모든 영역에서 완벽에 가까운 이해도를 보여주었습니다. 특히 공간 지각 능력이 뛰어나 도형 파트에서 두각을 나타냈습니다. 앞으로는 선행 학습보다는 현재 배운 내용을 심화 문제로 응용해보는 연습을 진행할 예정입니다."
    },
    'park': {
        name: '박민준',
        scores: [
            { month: '1월', score: null }, { month: '2월', score: 65 }, { month: '3월', score: 72 },
            { month: '4월', score: null }, { month: '5월', score: null }, { month: '6월', score: null },
            { month: '7월', score: null }, { month: '8월', score: null }, { month: '9월', score: null },
            { month: '10월', score: null }, { month: '11월', score: null }, { month: '12월', score: null }
        ],
        wrongNotes: { total: 35, completed: 10 },
        habits: { skipped: 15, rushed: 10, unread: 8, mistake: 5 },
        evaluations: [
            { week: '1주차', unit: '분수와 소수', score: 70, wrongQuestions: [2, 5, 8] },
            { week: '2주차', unit: '분수와 소수', score: 65, wrongQuestions: [1, 4, 7, 10] },
            { week: '3주차', unit: '도형의 넓이', score: 75, wrongQuestions: [3, 9] },
            { week: '4주차', unit: '규칙 찾기', score: 80, wrongQuestions: [6, 12] }
        ],
        attendance: {
            '2026-03-02': 'present', '2026-03-04': 'absent', '2026-03-09': 'late',
            '2026-03-11': 'makeup', '2026-03-16': 'present', '2026-03-18': 'absent',
            '2026-03-23': 'late', '2026-03-25': 'present', '2026-03-30': 'present'
        },
        descriptive: [
            { unit: '분수와 소수', thisAns: 5, thisTotal: 10, lastAns: 4, lastTotal: 10 },
            { unit: '도형의 넓이', thisAns: 6, thisTotal: 10, lastAns: 5, lastTotal: 10 }
        ],
        comment: "민준이는 3주차부터 집중력이 살아나며 성적이 상승 곡선을 그리고 있습니다! 다만 아직 연산 과정에서 성급하게 풀어 틀리는 경우가 많아, 문제풀이 속도를 조금 늦추고 검산하는 습관을 들이도록 지도하고 있습니다. 오답노트 밀린 부분만 잘 채워오면 다음 달엔 훨씬 좋은 결과가 있을 거예요."
    }
};

const statusLabels = {
    'present': '출석',
    'absent': '결석',
    'late': '지각',
    'makeup': '보강'
};

let currentYear = 2026;
let currentMonth = 3;

function changeMonth(delta) {
    currentMonth += delta;
    if (currentMonth > 12) {
        currentMonth = 1;
        currentYear++;
    } else if (currentMonth < 1) {
        currentMonth = 12;
        currentYear--;
    }
    const student = studentData[currentStudentId];
    renderCalendar(currentYear, currentMonth, student ? student.attendance : {});
}

function renderCalendar(year, month, attendanceData) {
    const grid = document.getElementById("calendarGrid");
    const headerTitle = document.getElementById("currentMonthYear");

    if (!grid) return;

    grid.innerHTML = '';
    headerTitle.textContent = `${year}년 ${month}월`;

    const daysOfWeek = ['일', '월', '화', '수', '목', '금', '토'];
    daysOfWeek.forEach((day, index) => {
        const div = document.createElement("div");
        div.className = "cal-day-header";
        if (index === 0) div.classList.add("day-sun");
        if (index === 6) div.classList.add("day-sat");
        div.textContent = day;
        grid.appendChild(div);
    });

    const firstDay = new Date(year, month - 1, 1).getDay();
    const lastDate = new Date(year, month, 0).getDate();

    // 빈 칸 채우기
    for (let i = 0; i < firstDay; i++) {
        const div = document.createElement("div");
        div.className = "cal-day empty";
        grid.appendChild(div);
    }

    let stats = { total: 0, present: 0, absent: 0, late: 0, makeup: 0 };

    for (let i = 1; i <= lastDate; i++) {
        const div = document.createElement("div");
        div.className = "cal-day";

        // 일요일, 토요일 글자 색상
        const currentDayOfWeek = new Date(year, month - 1, i).getDay();
        let dateClass = "cal-date";
        if (currentDayOfWeek === 0) dateClass += " day-sun";
        if (currentDayOfWeek === 6) dateClass += " day-sat";

        const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(i).padStart(2, '0')}`;

        // 2026-03 테스트 기간 가정
        const isToday = (year === 2026 && month === 3 && i === 15);
        if (isToday) div.classList.add('today');

        let contentHTML = `<span class="${dateClass}">${i}</span>`;

        if (attendanceData[dateStr]) {
            const status = attendanceData[dateStr];
            contentHTML += `<span class="cal-status status-${status}">${statusLabels[status]}</span>`;

            stats.total++;
            stats[status]++;
        }

        div.innerHTML = contentHTML;

        // 원클릭 출결 상태 변경 로직
        div.setAttribute('data-date', dateStr);
        div.style.cursor = 'pointer';
        div.title = '클릭하여 출결 상태 변경';
        div.addEventListener('click', () => {
            if (!attendanceData) attendanceData = {};
            const states = [undefined, 'present', 'late', 'absent', 'makeup'];
            let currentState = attendanceData[dateStr] || undefined;
            let nextIndex = (states.indexOf(currentState) + 1) % states.length;
            let nextState = states[nextIndex];

            if (nextState) {
                attendanceData[dateStr] = nextState;
            } else {
                delete attendanceData[dateStr];
            }
            renderCalendar(year, month, attendanceData);
        });

        grid.appendChild(div);
    }

    // 요약 테이블 업데이트
    const tbody = document.getElementById("attendanceSummaryBody");
    if (tbody) {
        tbody.innerHTML = `
            <tr>
                <td>${stats.total}일</td>
                <td class="text-success">${stats.present}일</td>
                <td class="text-danger">${stats.absent}일</td>
                <td class="text-warning">${stats.late}일</td>
                <td class="text-primary">${stats.makeup}일</td>
            </tr>
        `;
    }
}

function renderTable(evalData) {
    const tableBody = document.querySelector("#evaluationTable tbody");
    tableBody.innerHTML = '';

    evalData.forEach((item, index) => {
        const row = document.createElement("tr");

        // 틀린 문항 포맷팅
        const wrongText = item.wrongQuestions.length > 0
            ? item.wrongQuestions.join(', ') + '번'
            : '없음';

        row.innerHTML = `
            <td>${item.week}</td>
            <td class="unit-name editable-text" contenteditable="true" spellcheck="false" data-index="${index}" data-field="unit">${item.unit}</td>
            <td><span class="score-badge editable-text" contenteditable="true" spellcheck="false" data-index="${index}" data-field="score">${item.score}점</span></td>
            <td class="wrong-q editable-text" contenteditable="true" spellcheck="false" data-index="${index}" data-field="wrong">${wrongText}</td>
        `;

        // 데이터 양방향 바인딩 이벤트
        const cells = row.querySelectorAll('.editable-text');
        cells.forEach(cell => {
            cell.addEventListener('blur', (e) => {
                const val = e.target.textContent;
                const field = e.target.dataset.field;
                const idx = parseInt(e.target.dataset.index, 10);

                if (field === 'unit') {
                    evalData[idx].unit = val;
                } else if (field === 'score') {
                    let num = parseInt(val.replace(/[^0-9]/g, ''), 10);
                    if (!isNaN(num)) evalData[idx].score = num;
                } else if (field === 'wrong') {
                    if (val.trim() === '없음' || val.trim() === '') {
                        evalData[idx].wrongQuestions = [];
                    } else {
                        // 숫자만 추출
                        const matches = val.match(/\d+/g);
                        evalData[idx].wrongQuestions = matches ? matches.map(Number) : [];
                    }
                }

                // 테이블 데이터 변경 시 분석 코멘트 리렌더링
                analyzeDataAndRender(evalData);
            });

            // 엔터키 방지
            cell.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    e.target.blur();
                }
            });
        });

        tableBody.appendChild(row);
    });
}

function analyzeDataAndRender(evalData) {
    // 취약점 자동 분석 로직: 점수가 가장 낮은 주차를 탐색
    if (evalData.length === 0) return;

    let lowestData = evalData[0];

    evalData.forEach(item => {
        if (item.score < lowestData.score) {
            lowestData = item;
        }
    });

    const analysisBox = document.getElementById("analysisResult");

    // 자동 멘트 생성
    const wrongCount = lowestData.wrongQuestions.length;

    if (wrongCount === 0) {
        analysisBox.innerHTML = `<p>이번 달은 전반적으로 훌륭한 이해도를 보여주었습니다. 지금의 학습 페이스를 유지해주세요!</p>`;
        return;
    }

    let text = `<span class="highlight-unit">${lowestData.week}</span>에 진행된 <span class="highlight-unit">'${lowestData.unit}'</span> 파트에서 <strong>${lowestData.wrongQuestions.join(', ')}번</strong>을 틀린 것으로 보아 해당 영역의 원리 이해 및 보완이 필요해 보입니다. `;

    if (wrongCount >= 3) {
        text += `특히 여러 문항을 연달아 틀린 것으로 미루어 볼 때, 기본 개념으로 다시 돌아가 기초부터 다지는 학습 방향을 추천합니다.`;
    } else {
        text += `문제를 푸는 과정에서 잔실수는 없었는지 오답 노트를 통해 점검을 진행하겠습니다.`;
    }

    // 결과 렌더링 적용
    analysisBox.innerHTML = `<p>${text}</p>`;
}

function renderDescriptiveTable(descData) {
    const tableBody = document.querySelector("#descriptiveTable tbody");
    if (!tableBody) return;
    tableBody.innerHTML = '';

    descData.forEach((item, index) => {
        const row = document.createElement("tr");

        // 비율 계산
        const thisRatio = item.thisTotal > 0 ? (item.thisAns / item.thisTotal) * 100 : 0;
        const lastRatio = item.lastTotal > 0 ? (item.lastAns / item.lastTotal) * 100 : 0;

        row.innerHTML = `
            <td class="unit-name editable-text" contenteditable="true" spellcheck="false" data-index="${index}" data-field="unit">${item.unit}</td>
            <td style="width: 15%;">
                <span class="editable-text" contenteditable="true" spellcheck="false" data-index="${index}" data-field="thisAns">${item.thisAns}</span> /
                <span class="editable-text" contenteditable="true" spellcheck="false" data-index="${index}" data-field="thisTotal">${item.thisTotal}</span>
            </td>
            <td style="width: 15%;">
                <span class="editable-text" contenteditable="true" spellcheck="false" data-index="${index}" data-field="lastAns">${item.lastAns}</span> /
                <span class="editable-text" contenteditable="true" spellcheck="false" data-index="${index}" data-field="lastTotal">${item.lastTotal}</span>
            </td>
            <td>
                <div class="mini-bar-wrap">
                    <div class="mini-bar-col">
                        <div class="mini-bar-bg"><div class="mini-bar-fill fill-this" style="height: ${thisRatio}%"></div></div>
                        <span class="mini-bar-label">이번달</span>
                    </div>
                    <div class="mini-bar-col">
                        <div class="mini-bar-bg"><div class="mini-bar-fill fill-last" style="height: ${lastRatio}%"></div></div>
                        <span class="mini-bar-label">지난달</span>
                    </div>
                </div>
            </td>
        `;

        // 데이터 양방향 바인딩 이벤트
        const cells = row.querySelectorAll('.editable-text');
        cells.forEach(cell => {
            cell.addEventListener('blur', (e) => {
                const val = e.target.textContent;
                const field = e.target.dataset.field;
                const idx = parseInt(e.target.dataset.index, 10);

                if (field === 'unit') {
                    descData[idx].unit = val;
                } else {
                    let num = parseInt(val.replace(/[^0-9]/g, ''), 10);
                    if (!isNaN(num)) descData[idx][field] = num;
                }
                renderDescriptiveTable(descData);
            });
            cell.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); }
            });
        });

        tableBody.appendChild(row);
    });
}

function renderTrendTable(scores) {
    const tr = document.getElementById('trendInputs');
    if (!tr) return;
    tr.innerHTML = '';

    scores.forEach((item, index) => {
        const td = document.createElement('td');
        td.innerHTML = `<span class="editable-text" contenteditable="true" spellcheck="false" data-index="${index}">${item.score === null ? '-' : item.score}</span>`;

        const input = td.querySelector('.editable-text');
        input.addEventListener('blur', (e) => {
            const val = e.target.textContent.trim();
            const idx = parseInt(e.target.dataset.index, 10);

            if (val === '-' || val === '') {
                scores[idx].score = null;
                // 다시 - 기호로 세팅하여 시각적 일관성 유지
                e.target.textContent = '-';
            } else {
                let num = parseInt(val.replace(/[^0-9-]/g, ''), 10);
                if (!isNaN(num)) {
                    scores[idx].score = num;
                    e.target.textContent = num;
                } else {
                    scores[idx].score = null;
                    e.target.textContent = '-';
                }
            }
            renderScoreChart(scores);
        });
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); }
        });

        tr.appendChild(td);
    });
}

function renderScoreChart(scores) {
    const ctx = document.getElementById('scoreChart').getContext('2d');

    if (scoreChartInstance) {
        scoreChartInstance.destroy();
    }

    renderTrendTable(scores);

    // 차트 데이터 구성 - 빈 값('-')은 null로 처리하여 선을 끊지 않고 이어지거나 점만 찍히도록 함
    const labels = scores.map(item => item.month);
    const data = scores.map(item => item.score);
    const primarySolid = '#0ea5e9'; // 선 및 포인트 컬러
    const pointColors = data.map(val => val === null ? 'transparent' : primarySolid);

    scoreChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: '평균 점수',
                data: data,
                borderColor: primarySolid,
                backgroundColor: 'rgba(14, 165, 233, 0.1)',
                borderWidth: 3,
                pointBackgroundColor: pointColors,
                pointBorderColor: pointColors,
                pointRadius: 5,
                pointHoverRadius: 7,
                fill: true,
                tension: 0.3, // 곡선
                spanGaps: true // null 값이 있어도 선을 이어서 연결
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false // 범례 숨김
                },
                tooltip: {
                    callbacks: {
                        label: function (context) {
                            return context.parsed.y === null ? '데이터 없음' : context.parsed.y + '점';
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    max: 100,
                    grid: {
                        color: 'rgba(0,0,0,0.05)',
                        drawBorder: false
                    },
                    ticks: {
                        stepSize: 20
                    }
                },
                x: {
                    grid: {
                        display: false
                    }
                }
            },
            animation: {
                duration: 1500,
                easing: 'easeOutQuart'
            }
        }
    });
}

function renderHabits(habits) {
    const habitList = document.querySelector(".habit-list");
    habitList.innerHTML = `
        <li>
            <span>건너뛴 문제</span>
            <strong class="editable-text" contenteditable="true" spellcheck="false" data-habit="skipped">${habits.skipped}개</strong>
        </li>
        <li>
            <span>급하게 풀어 틀린 문제</span>
            <strong class="editable-text" contenteditable="true" spellcheck="false" data-habit="rushed">${habits.rushed}개</strong>
        </li>
        <li>
            <span>읽지 않고 푼 문제</span>
            <strong class="editable-text" contenteditable="true" spellcheck="false" data-habit="unread">${habits.unread}개</strong>
        </li>
        <li>
            <span>실수한 문제</span>
            <strong class="editable-text" contenteditable="true" spellcheck="false" data-habit="mistake">${habits.mistake}개</strong>
        </li>
    `;

    // 습관 데이터 수정 바인딩
    const editableHabits = habitList.querySelectorAll('.editable-text');
    editableHabits.forEach(el => {
        el.addEventListener('blur', (e) => {
            const val = e.target.textContent;
            const field = e.target.dataset.habit;
            let num = parseInt(val.replace(/[^0-9]/g, ''), 10);
            if (!isNaN(num)) {
                habits[field] = num;
            }
        });
        el.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                e.target.blur();
            }
        });
    });
}

function renderWrongNoteChart(wrongData) {
    const ctx = document.getElementById('wrongNoteChart');
    if (!ctx) return;

    if (wrongNoteChartInstance) {
        wrongNoteChartInstance.destroy();
    }

    const total = wrongData.total;
    const completed = wrongData.completed;
    const remaining = total - completed < 0 ? 0 : total - completed;

    // 텍스트 업데이트 (ID 기반으로 타겟팅)
    document.getElementById('editWrongTotal').textContent = total;
    document.getElementById('editWrongCompleted').textContent = completed;
    document.getElementById('wrongNoteTotal').innerHTML = `총 <span style="font-size: 1.1rem; font-weight:700;">${total}</span>개`;

    wrongNoteChartInstance = new Chart(ctx.getContext('2d'), {
        type: 'doughnut',
        data: {
            labels: ['완료', '미완료'],
            datasets: [{
                data: [completed, remaining],
                backgroundColor: [
                    '#4f46e5', // 진본색 (완료)
                    '#e2e8f0'  // 회색 (미완료)
                ],
                borderWidth: 0,
                hoverOffset: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '75%', // 도넛 중앙 빈 공간 크기
            plugins: {
                legend: {
                    display: false // 범례 숨김
                },
                tooltip: {
                    callbacks: {
                        label: function (context) {
                            return context.label + ': ' + context.parsed + '개';
                        }
                    }
                }
            },
            animation: {
                animateScale: true,
                animateRotate: true,
                duration: 1000
            }
        }
    });
}

// 리포트 이미지 저장 로직
async function downloadReportAsImage() {
    const targetElement = document.getElementById('reportCaptureArea');
    const btn = document.getElementById('downloadBtn');

    try {
        // 캡처 전 버튼 텍스트 변경
        const originalText = btn.innerHTML;
        btn.innerHTML = `<span class="icon">⏳</span> 캡처 중...`;
        btn.disabled = true;

        // html2canvas 옵션 설정: 스케일 높여서 고화질 캡처, 애니메이션 완료 후 실행하도록 살짝 지연
        await new Promise(resolve => setTimeout(resolve, 500));

        // CSS 조정용 클래스 추가
        targetElement.classList.add('capture-mode');

        const canvas = await html2canvas(targetElement, {
            scale: 2, // 2배율(고화질)
            useCORS: true,
            backgroundColor: '#f0f9ff' // 배경색 동일하게 지정
        });

        // CSS 조정 원복
        targetElement.classList.remove('capture-mode');

        // 다운로드용 링크 생성
        const studentName = studentData[currentStudentId].name;
        const link = document.createElement('a');
        link.download = `3월_수학_리포트_${studentName}.png`;
        link.href = canvas.toDataURL('image/png');
        link.click();

        // 캡처 후 상태 복원
        btn.innerHTML = originalText;
        btn.disabled = false;
    } catch (error) {
        console.error('이미지 저장 중 오류 발생:', error);
        alert('이미지 저장에 실패했습니다.');
        btn.disabled = false;
        targetElement.classList.remove('capture-mode');
    }
}
