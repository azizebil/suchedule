const config = {
    infoLinkBase: 'https://suis.sabanciuniv.edu/prod/bwckschd.p_disp_detail_sched'
};

Object.freeze(config);

//  The active term changes at runtime now, so the link cannot be baked in at load time.
const getInfoLink = (term, crn) => `${config.infoLinkBase}?term_in=${term}&crn_in=${crn}`;

const terms = (() => {
    //  Term codes are YYYY + season, where the year is the start of the academic year.
    //  Verified against bannerweb's own term list: 202601 is "Fall 2026-2027".
    const seasons = {'01': 'Fall', '02': 'Spring', '03': 'Summer'};

    let list = [];

    const getSeason = term => seasons[term.slice(4)] || term.slice(4);

    const getLabel = term => {
        const year = Number(term.slice(0, 4));

        return `${year}-${year + 1} ${getSeason(term)}`;
    };

    const setList = value => list = value;

    const getList = () => list;

    //  terms.json keeps the newest term first.
    const getCurrent = () => list[0].term;

    const has = term => list.some(entry => entry.term === term);

    const getVersion = term => list.find(entry => entry.term === term).dataVersion;

    const getActive = () => {
        const stored = localStorage.getItem('active-term');

        return has(stored) ? stored : getCurrent();
    };

    const setActive = term => localStorage.setItem('active-term', term);

    const dataFile = term => `data/data-${term}-v${getVersion(term)}.min.json`;

    const cacheKey = term => `course-data-${term}-${getVersion(term)}`;

    //  Only drops what no longer matches terms.json. The old blanket "delete anything
    //  containing saved-schedule" wiped the other term's schedule on every data update.
    const clearOutdated = () => {
        const validCaches = list.map(entry => cacheKey(entry.term));
        const knownTerms = list.map(entry => entry.term);
        const outdated = [];

        Object.keys(localStorage).forEach(key => {
            if (key.indexOf('course-data-') === 0) {
                //  The cache order list shares the prefix but is not a cache itself.
                if (key === 'course-data-lru' || validCaches.indexOf(key) > -1) {
                    return;
                }

                const term = key.split('-')[2];

                if (knownTerms.indexOf(term) > -1 && outdated.indexOf(term) === -1) {
                    outdated.push(term);
                }

                localStorage.removeItem(key);

                return;
            }

            if (key.indexOf('saved-schedules-') === 0 || key.indexOf('active-scenario-') === 0) {
                if (knownTerms.indexOf(key.slice(key.lastIndexOf('-') + 1)) === -1) {
                    localStorage.removeItem(key);
                }
            }
        });

        //  A term whose data changed keeps its tabs but loses their crns, which may no
        //  longer exist. Terms that did not change are left alone.
        outdated.forEach(term => {
            localStorage.removeItem(`saved-schedules-${term}`);
            localStorage.removeItem(`active-scenario-${term}`);
        });

        return outdated;
    };

    //  Nine flat rows are hard to scan, so they are grouped by academic year with the
    //  season alone on each row - the year is already the group heading.
    const renderSelect = () => {
        const groups = [];

        list.forEach(entry => {
            const year = entry.term.slice(0, 4);
            const group = groups.find(candidate => candidate.year === year);

            (group || groups[groups.push({year, terms: []}) - 1]).terms.push(entry.term);
        });

        $('#term-select').html(groups.map(group => templateGenerator.makeTermGroup(
            `${group.year}-${Number(group.year) + 1}`,
            group.terms.map(term => templateGenerator.makeTermOption(term, getSeason(term))).join('')
        )).join('')).val(getActive());
    };

    const updateNotice = () => {
        const active = getActive();

        $('#term-notice')
            .toggle(active !== getCurrent())
            .text(`Viewing a past term (${getLabel(active)})`);
    };

    return {
        getLabel, getSeason, setList, getList, getCurrent, has, getVersion, getActive, setActive,
        dataFile, cacheKey, clearOutdated, renderSelect, updateNotice
    };
})();

const courseData = (() => {
    //  Nine terms cached at once would be roughly 1.6 MB of text, and localStorage counts
    //  UTF-16, so about 3.2 MB against a typical 5 MB quota - close enough to hurt. Only
    //  the two most recently used terms are kept; the rest come back over HTTP, where the
    //  browser's own cache already serves them from a static host at no real cost.
    const KEEP = 2;

    const recentKey = 'course-data-lru';

    const readRecent = () => {
        try {
            const stored = JSON.parse(localStorage.getItem(recentKey));

            return Array.isArray(stored) ? stored : [];
        } catch (error) {
            return [];
        }
    };

    const touch = term => {
        const recent = [term].concat(readRecent().filter(entry => entry !== term));

        //  Anything past the limit loses its cache, and so does any cache whose term is
        //  no longer in the list at all.
        recent.slice(KEEP).forEach(stale => localStorage.removeItem(terms.cacheKey(stale)));

        localStorage.setItem(recentKey, JSON.stringify(recent.slice(0, KEEP)));
    };

    const load = term => {
        const cached = localStorage.getItem(terms.cacheKey(term));

        if (cached !== null) {
            touch(term);

            return $.Deferred().resolve(JSON.parse(cached)).promise();
        }

        return $.getJSON(terms.dataFile(term)).then(data => {
            try {
                //  Evict first: writing then trimming would need the quota for both at once.
                touch(term);

                localStorage.setItem(terms.cacheKey(term), JSON.stringify(data));
            } catch (error) {
                //  A full quota throws rather than failing quietly. The term still loads,
                //  it just gets fetched again next time instead of breaking the page.
                localStorage.removeItem(terms.cacheKey(term));
            }

            return data;
        });
    };

    return {load};
})();

const templateGenerator = (() => {
    const getDayFromCode = (() => {
        // const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'TBA'];
        const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'TBA'];

        return dayCode => {
            return days[dayCode];
        };
    })();

    const getScheduleHours = (start, duration) => {
        if (start === -1) return 'TBA';

        start += 8;

        const end = start + duration;

        return `${start < 10 ? '0' : ''}${start}:40-${end < 10 ? '0' : ''}${end}:30`;
    };

    //  == null on purpose, never a truthy test: a real 0 credit is information and
    //  must not be shown as N/A. Only null and undefined mean "the catalog did not say".
    const creditValue = value => value == null ? 'N/A' : value;

    //  Empty attribute means the catalog had nothing, which is not the same as zero.
    const creditAttribute = value => value == null ? '' : value;

    const makeCourseCredits = course => `
                <div class="course-credits"
                     title="Read from the Banner catalog. Confirm with your advisor before relying on it.">
                    <span>SU <b>${creditValue(course.cr)}</b></span>
                    <span>ECTS <b>${creditValue(course.ects)}</b></span>
                    <span>Eng <b>${creditValue(course.eng)}</b></span>
                    <span>Basic <b>${creditValue(course.bsc)}</b></span>
                </div>
    `;

    const makeCourseEntry = (course, instructors, places, term) => `
        <div class="course-entry hide-info" data-code="${course.code}"
             data-cr="${creditAttribute(course.cr)}" data-ects="${creditAttribute(course.ects)}"
             data-eng="${creditAttribute(course.eng)}" data-bsc="${creditAttribute(course.bsc)}">
            <div class="course-header">
                <div class="course-name">${course.code} - ${course.name}</div>
                <div class="course-expand icon-right-open-big"></div>
            </div>
            <div class="course-info">
            ${makeCourseCredits(course)}
            ${course.classes.map(_class => `
                <div class="course-sections">
                    <div class="section-type">Sections${_class.type ? ` (${_class.type})` : ``}</div>
                ${_class.sections.map(section => `
                    <div class="course-section" 
                        data-section-name="${course.code.replace(' ', '')}${_class.type} - ${section.group}"
                        data-crn="${section.crn}">
                    <div class="section-info">
                        <div class="section-header">
                            <div class="section-group" data-group="${section.group}">${section.group}</div>
                            <a href="${getInfoLink(term, section.crn)}" class="section-link" target="_blank">info</a>
                        </div>
                        <div class="instructor">${instructors[section.instructors]}</div>
                        <div class="section-days">
                        ${section.schedule.map(schedule => `
                            <div class="section-day" 
                                data-day="${schedule.day}"
                                data-start="${schedule.start}" 
                                data-duration="${schedule.duration}"
                                data-place="${places[schedule.place]}">
                                ${getDayFromCode(schedule.day)} ${getScheduleHours(schedule.start, schedule.duration)} ${places[schedule.place]}
                            </div>
                        `).join('')}
                        </div>
                    </div>
                    <div class="section-button"></div>
                    </div>
                `).join('')}
                </div>
            `).join('')}
            </div>
        </div>
    `;

    const makeCellCourse = (sectionName, crn, bgColor = 'azure') => `
        <div class="cell-course" data-crn="${crn}" data-section-name="${sectionName}"
            style="background-color: ${bgColor};">
            <div>${sectionName}</div>
            <div class="remove-course"></div>
        </div>
    `;

    //  Plan names are user typed, so they go through the DOM rather than into the markup.
    const escapeHtml = text => $('<div>').text(text).html();

    const makeScenarioTab = (plan, index, isActive, isNew) => `
        <div class="scenario-tab${isActive ? ' active' : ''}${isNew ? ' entering' : ''}"
            data-scenario="${index}" draggable="true">
            <span class="scenario-tab-name" title="Double click to rename">${escapeHtml(plan.name)}</span>
            <span class="scenario-tab-close" title="Close this plan">&times;</span>
        </div>
    `;

    const makeScenarioAddButton = () => `<div id="scenario-add" title="New plan">+</div>`;

    const makeTermOption = (term, label) => `<option value="${term}">${label}</option>`;

    const makeTermGroup = (label, options) => `<optgroup label="${label}">${options}</optgroup>`;

    //  Two plain range inputs rather than a dual-handle widget: the browser has no such
    //  control and pulling in a slider library would put back the CDN dependency we removed.
    const makeCreditMetric = (metric, bound, range) => `
        <div class="credit-metric" data-metric="${metric.key}">
            <div class="credit-metric-head">
                <span>${metric.label}</span>
                <span class="credit-metric-value">${range[0]} &ndash; ${range[1]}${range[1] >= bound.max && bound.raw > bound.max ? '+' : ''}</span>
            </div>
            <div class="credit-slider">
                <div class="credit-track"></div>
                <div class="credit-fill"></div>
                <input class="credit-min" type="range" min="0" max="${bound.max}" value="${range[0]}"
                       title="${metric.label} minimum">
                <input class="credit-max" type="range" min="0" max="${bound.max}" value="${range[1]}"
                       title="${metric.label} maximum">
            </div>
        </div>
    `;

    const makeCreditTotals = (totals, incomplete) => `
        <span class="credit-total-label">Totals</span>
        <span>SU <b>${totals.cr}</b></span>
        <span>ECTS <b>${totals.ects}</b></span>
        <span>Eng <b>${totals.eng}</b></span>
        <span>Basic <b>${totals.bsc}</b></span>
        ${incomplete > 0
            ? `<span class="credit-total-note">${incomplete} course${incomplete === 1 ? '' : 's'} without catalog data</span>`
            : ``}
    `;

    return {
        makeCourseEntry,
        makeCellCourse,
        makeCourseCredits,
        makeCreditTotals,
        makeCreditMetric,
        makeScenarioTab,
        makeScenarioAddButton,
        makeTermOption,
        makeTermGroup
    };
})();

const colorPalette = (() => {
    let colors = [
        '#2096BA',
        '#C5919D',
        '#DF6E21',
        '#874E4C',
        '#32485C',
        '#765285',
        '#351C4D',
        '#FF7E5F',
        '#726A95',
        '#849974',
        '#36384C',
        '#F26968',
        '#F2AD9F',
        '#6CBF84',
        '#323339',
        '#AB3E16',
        '#EFAA52',
        '#48120E',
        '#B37C57',
        '#9AACB8'
    ];
    const initial = colors.slice(0);

    return {
        getColor: () => colors.splice(Math.floor(Math.random() * colors.length), 1).shift() || 'azure',
        putColor: color => color === 'azure' ? null : colors.push(color),
        reset: () => colors = initial.slice(0)
    };
})();

const scenarios = (() => {
    const MAX = 5;
    const LETTERS = 'ABCDE';

    //  Keyed per term: each term keeps its own set of plans and its own active tab.
    const storageKey = () => `saved-schedules-${terms.getActive()}`;

    const activeKey = () => `active-scenario-${terms.getActive()}`;

    let plans = [];
    let pendingClose = null;

    const write = () => localStorage.setItem(storageKey(), JSON.stringify(plans));

    const count = () => plans.length;

    const nextName = () => {
        for (const letter of LETTERS) {
            if (!plans.some(plan => plan.name === `Plan ${letter}`)) {
                return `Plan ${letter}`;
            }
        }

        return `Plan ${plans.length + 1}`;
    };

    const getActiveIndex = () => {
        const stored = Number(localStorage.getItem(activeKey())) || 0;

        return stored >= 0 && stored < plans.length ? stored : 0;
    };

    const getName = index => plans[index].name;

    const getActiveName = () => getName(getActiveIndex());

    const crnCount = index => {
        const crns = plans[index].crns;

        return crns === '' ? 0 : crns.split(',').length;
    };

    const saveActive = crns => {
        plans[getActiveIndex()].crns = crns;

        write();
    };

    //  Only called when the plan list itself changes. Switching tabs merely moves the
    //  active class, so the elements keep their identity and dblclick-to-rename survives.
    //  enteringIndex marks the one tab that should play its entry animation.
    const renderTabs = (enteringIndex = -1) => {
        const activeIndex = getActiveIndex();

        $('#scenario-tabs')
            .toggleClass('single-plan', plans.length === 1)
            .html(
                plans.map((plan, index) =>
                    templateGenerator.makeScenarioTab(plan, index, index === activeIndex, index === enteringIndex))
                    .join('') + (plans.length < MAX ? templateGenerator.makeScenarioAddButton() : '')
            );
    };

    const markActiveTab = () => {
        $('.scenario-tab').removeClass('active')
            .filter(`[data-scenario="${getActiveIndex()}"]`).addClass('active');
    };

    //  Deliberately does not save: switching tabs resets the table before loading the
    //  target plan, and saving in between would overwrite that plan with an empty one.
    const clearScheduleDom = () => {
        $('.course-section.selected').removeClass('selected');
        $('.class-cell').attr('class', 'class-cell').children().remove();

        colorPalette.reset();
    };

    const load = index => {
        if (plans[index].crns === '') {
            return;
        }

        plans[index].crns.split(',').forEach(crn => {
            $(`.course-section[data-crn="${crn}"]`).click();
        });
    };

    const switchTo = index => {
        //  Set first: the clicks below run through addToSchedule, which saves to the active plan.
        localStorage.setItem(activeKey(), index);

        markActiveTab();

        if (courseEntry.isOnDisplayMode()) {
            courseEntry.endDisplayMode();
        }

        clearScheduleDom();

        load(index);

        //  Switching to an empty plan produces no clicks at all, so the conflict filter
        //  would keep hiding sections based on the plan we just left, and the totals
        //  would still show the previous plan's credits.
        sectionEntry.filterByConflicts();

        creditTotals.update();
    };

    const add = (crns = '') => {
        if (plans.length >= MAX) {
            return getActiveIndex();
        }

        plans.push({name: nextName(), crns});

        write();
        renderTabs(plans.length - 1);

        switchTo(plans.length - 1);

        return plans.length - 1;
    };

    //  The tab plays its exit animation before the list actually changes, so the
    //  remaining tabs only reflow once, after it is gone.
    const close = index => {
        const $tab = $(`.scenario-tab[data-scenario="${index}"]`);

        if (plans.length <= 1 || $tab.hasClass('leaving')) {
            return;
        }

        const remove = () => {
            const activeIndex = getActiveIndex();

            plans.splice(index, 1);

            write();
            renderTabs();

            switchTo(index < activeIndex ? activeIndex - 1 : Math.min(activeIndex, plans.length - 1));
        };

        if ($tab.length === 0) {
            remove();

            return;
        }

        $tab.addClass('leaving');

        setTimeout(remove, 160);
    };

    const move = (from, to) => {
        if (from === to || plans[from] === undefined || plans[to] === undefined) {
            return;
        }

        //  Tracked by identity so the same plan stays active wherever it lands.
        const activePlan = plans[getActiveIndex()];

        plans.splice(to, 0, plans.splice(from, 1).shift());

        localStorage.setItem(activeKey(), plans.indexOf(activePlan));

        write();
        renderTabs();
    };

    const requestClose = index => {
        if (plans.length <= 1) {
            return;
        }

        if (crnCount(index) === 0) {
            close(index);

            return;
        }

        pendingClose = index;

        $('#notify-close-plan .notification-content p').text(
            `${getName(index)} has ${crnCount(index)} course${crnCount(index) === 1 ? '' : 's'} in it.` +
            ` Closing it cannot be undone.`
        );

        $('#notify-close-plan').fadeIn(500);
    };

    const confirmClose = () => {
        if (pendingClose === null) {
            return;
        }

        close(pendingClose);

        pendingClose = null;
    };

    const rename = (index, name) => {
        plans[index].name = name.replace(/\s+/g, ' ').trim().slice(0, 24) || nextName();

        write();
        renderTabs();
    };

    const replaceActive = crns => {
        plans[getActiveIndex()].crns = crns;

        write();

        switchTo(getActiveIndex());
    };

    const sanitise = value => (Array.isArray(value) ? value : [])
        .filter(plan => plan !== null && typeof plan === 'object' && typeof plan.crns === 'string')
        .map(plan => ({name: String(plan.name || ''), crns: plan.crns}))
        .slice(0, MAX);

    const read = key => {
        try {
            return sanitise(JSON.parse(localStorage.getItem(key)));
        } catch (error) {
            return [];
        }
    };

    //  Every earlier layout was term-less, so its schedules belong to the current term.
    //  Without this, upgrading users open the app to an empty schedule.
    const migrateLegacy = currentTerm => {
        const target = `saved-schedules-${currentTerm}`;

        if (localStorage.getItem(target) === null) {
            let carried = read('saved-schedules');

            if (carried.length === 0) {
                //  Before the single key there were three fixed plans, and before those one schedule.
                carried = ['saved-schedule-0', 'saved-schedule-1', 'saved-schedule-2', 'saved-schedule']
                    .map(key => localStorage.getItem(key))
                    .filter(crns => crns !== null && crns !== '')
                    .map((crns, index) => ({name: `Plan ${LETTERS[index]}`, crns}));
            }

            if (carried.length > 0) {
                localStorage.setItem(target, JSON.stringify(carried));

                const legacyActive = localStorage.getItem('active-scenario');

                if (legacyActive !== null) {
                    localStorage.setItem(`active-scenario-${currentTerm}`, legacyActive);
                }
            }
        }

        ['saved-schedule', 'saved-schedule-0', 'saved-schedule-1', 'saved-schedule-2',
            'saved-schedules', 'active-scenario'].forEach(key => localStorage.removeItem(key));
    };

    //  Called on every term switch: the plan list belongs to the term, not to the session.
    const loadForActiveTerm = () => {
        plans = read(storageKey());

        if (plans.length === 0) {
            plans = [{name: `Plan ${LETTERS[0]}`, crns: ''}];
        }

        write();
    };

    return {
        MAX, count, nextName, getActiveIndex, getName, getActiveName, crnCount, saveActive,
        clearScheduleDom, renderTabs, switchTo, add, requestClose, confirmClose, rename, replaceActive, move,
        migrateLegacy, loadForActiveTerm
    };
})();

const creditTotals = (() => {
    const fields = ['cr', 'ects', 'eng', 'bsc'];

    //  Summed per course, not per section: a course's lecture and its recitation are two
    //  cell-courses but one set of credits, so the codes are deduplicated first.
    const update = () => {
        const onSchedule = {};

        $('.cell-course').each((i, element) => {
            onSchedule[cellCourses($(element)).getCourseCodeWithoutSpace()] = 1;
        });

        const totals = {cr: 0, ects: 0, eng: 0, bsc: 0};

        let counted = 0;
        let incomplete = 0;

        $('.course-entry').each((i, element) => {
            const $entry = $(element);

            if (!onSchedule.hasOwnProperty(courseEntry($entry).getCodeWithoutSpace())) {
                return;
            }

            counted++;

            let missing = false;

            fields.forEach(field => {
                const raw = $entry.attr(`data-${field}`);

                //  '' is the catalog saying nothing; 0 is the catalog saying zero.
                if (raw === '' || raw === undefined) {
                    missing = true;

                    return;
                }

                totals[field] += Number(raw);
            });

            if (missing) {
                incomplete++;
            }
        });

        if (counted === 0) {
            $('#credit-total').hide();

            return;
        }

        $('#credit-total').show().html(templateGenerator.makeCreditTotals(totals, incomplete));
    };

    return {update};
})();

const saveSchedule = () => {
    scenarios.saveActive(cellCourses.getAllCrnDataToSave().join(','));
};

const courseEntry = (() => {
    const courseEntry = function (codeOr$element) {
        if (!(codeOr$element instanceof $)) {
            return courseEntry.findByCode(codeOr$element);
        }

        return new courseEntry.prototype.Init(codeOr$element);
    };

    courseEntry.prototype.Init = function ($element) {
        this.getElement = function () {
            return $element.first();
        };

        return this;
    };

    courseEntry.prototype.Init.prototype = courseEntry.prototype;

    courseEntry.prototype.isOpen = function () {
        return !this.getElement().hasClass('hide-info');
    };

    courseEntry.prototype.open = function () {
        this.getElement().removeClass('hide-info');

        this.getElement().siblings(':not(hide-info)').addClass('hide-info');

        this.updateSelectionsOnSchedule();

        return this;
    };

    courseEntry.prototype.close = function () {
        this.getElement().addClass('hide-info');

        this.hideSelectionsOnSchedule();

        return this;
    };

    courseEntry.prototype.toggleOpen = function () {
        this.isOpen() ? this.close() : this.open();

        return this;
    };

    courseEntry.prototype.getCodeWithSpace = function () {
        return this.getElement().data('code');
    };

    courseEntry.prototype.getCodeWithoutSpace = function () {
        return this.getElement().data('code').replace(/ /g, '');
    };

    courseEntry.prototype.getName = function () {
        return this.getElement().find('.course-name').text();
    };

    //  Only the first 3 digits carry the level: special topic courses are numbered
    //  with 4 or 5 digits (CS 48012, EE 4801), so the raw number would misclassify them.
    courseEntry.prototype.getCourseLevel = function () {
        const number = this.getCodeWithSpace().replace(/^[A-Z]+\s*(\d+).*$/, '$1');

        return Number(number.slice(0, 3));
    };

    courseEntry.prototype.isGraduate = function () {
        return this.getCourseLevel() >= 500;
    };

    courseEntry.prototype.showSelectionsOnSchedule = function () {
        this.getSections('.course-section.selected').forEach(section => {
            section.getClassCells().getElements().addClass('selection');
        });

        return this;
    };

    courseEntry.prototype.hideSelectionsOnSchedule = function () {
        $('.class-cell').removeClass('selection');

        return this;
    };

    courseEntry.prototype.updateSelectionsOnSchedule = function () {
        this.hideSelectionsOnSchedule();

        if (this.isOpen() && !this.isSelectionComplete()) {
            this.showSelectionsOnSchedule();
        }

        return this;
    };

    courseEntry.prototype.addFilter = function (filterName) {
        this.getElement().addClass(`filter-hide-${filterName}`);

        return this;
    };

    courseEntry.prototype.removeFilter = function (filterName) {
        this.getElement().removeClass(`filter-hide-${filterName}`);

        return this;
    };

    courseEntry.prototype.nameContains = function (query) {
        let name = this.getName();
        name = name.replaceAll(/\s+/g, '').toUpperCase();
        return name.indexOf(query) > -1;
    };

    courseEntry.prototype.isSelectionComplete = function () {
        return this.getElement().find('.selected').length === this.getElement().find('.course-sections').length;
    };

    courseEntry.prototype.isMainCourseSelected = function () {
        return this.getElement().find('.course-sections:first .selected').length > 0;
    };

    courseEntry.prototype.getSections = function (selector = '.course-section') {
        return $.map(this.getElement().find(selector), section => sectionEntry($(section)));
    };

    courseEntry.prototype.getCellCourseColor = function () {
        return cellCourses.findByCourseCode(this.getCodeWithoutSpace()).getColor();
    };

    courseEntry.prototype.isOnSchedule = function () {
        return cellCourses.findByCourseCode(this.getCodeWithoutSpace()).getElements().length > 0;
    };

    courseEntry.prototype.addToSchedule = function () {
        this.hideSelectionsOnSchedule();

        const color = colorPalette.getColor();

        this.getSections('.course-section.selected').forEach(section => {
            section.getClassCells().addCellCourse(cellCourses.make(section.getName(), section.getCrn(), color));
        });

        saveSchedule();

        sectionEntry.filterByConflicts();

        creditTotals.update();

        return this;
    };

    courseEntry.prototype.removeFromSchedule = function () {
        if (this.isOnSchedule()) {
            colorPalette.putColor(this.getCellCourseColor());

            this.getSections().forEach(section => {
                classCells.findContainsCrn(section.getCrn()).removeCellCourse(section.getCrn());
            });
        }

        this.updateSelectionsOnSchedule();

        saveSchedule();

        sectionEntry.filterByConflicts();

        creditTotals.update();

        return this;
    };

    courseEntry.prototype.actOnSectionSelected = function () {
        this.updateSelectionsOnSchedule();

        if (this.isSelectionComplete()) {
            this.addToSchedule();
        }

        return this;
    };

    courseEntry.prototype.actOnSectionDeselected = function () {
        this.removeFromSchedule();

        if (this.isMainCourseSelected() && !this.isOpen()) {
            courseEntry.endDisplayMode();
            courseEntry.startDisplayMode(this.getCodeWithSpace());
        }

        return this;
    };

    courseEntry.prototype.hasEmptySection = function () {
        for (const courseSections of this.getElement().find('.course-sections')) {
            if ($(courseSections).find('.course-section:not([class*=filter-hide-])').length === 0) {
                return true;
            }
        }

        return false;
    };

    courseEntry.closeAll = () => {
        $('.course-entry').addClass('hide-info');
    };

    courseEntry.findByCode = code => courseEntry($(`.course-entry[data-code="${code}"]`));

    courseEntry.clearFilter = filterName => {
        $('.course-entry').removeClass(`filter-hide-${filterName}`);

        creditFilter.refresh();
    };

    //  Refreshed here rather than only from the credit panel, so the count reacts to the
    //  level filter, the search box and the conflict filter as well - every one of them
    //  ends up adding or removing a filter-hide class through this function.
    courseEntry.filter = (filter, filterName) => {
        $('.course-entry').each((i, course) => {
            course = courseEntry($(course));

            filter(course) ? course.removeFilter(filterName) : course.addFilter(filterName);
        });

        creditFilter.refresh();
    };

    courseEntry.filterIfAnyEmptySection = () => {
        courseEntry.filter(
            course => !course.hasEmptySection(),
            'empty-section'
        );
    };

    courseEntry.filterByLevel = () => {
        const mode = $('input[name=level-filter]:checked').val();

        if (mode === 'all') {
            courseEntry.clearFilter('level');

            return;
        }

        courseEntry.filter(
            course => course.isGraduate() === (mode === 'grad'),
            'level'
        );
    };

    courseEntry.filterByCredits = () => {
        if (creditFilter.isAtFullRange()) {
            courseEntry.clearFilter('credit');
        } else {
            courseEntry.filter(course => creditFilter.matches(course.getElement()), 'credit');
        }

        creditFilter.refresh();
    };

    courseEntry.startDisplayMode = code => {
        courseEntry(code).open().getElement().addClass('display-alone');

        $('#menu').addClass('display-mode');

        $('body').removeClass('hide-menu');
    };

    courseEntry.endDisplayMode = () => {
        courseEntry($('.display-alone')).close().getElement().removeClass('display-alone');

        $('#menu').removeClass('display-mode');
    };

    courseEntry.isOnDisplayMode = () => $('#menu').hasClass('display-mode');

    courseEntry.make = (course, instructors) => courseEntry(templateGenerator.makeCourseEntry(course, instructors));

    //  Filters are not applied here any more: populate now runs on every term switch, and
    //  the freshly built entries carry no filter-hide classes at all, so the caller has to
    //  re-run every filter rather than just the level one.
    courseEntry.populate = (courses, instructors, places, term) => {
        const $list = $('#course-list').removeClass('loading');

        courses.forEach(course => {
            $list.append(templateGenerator.makeCourseEntry(course, instructors, places, term));
        });
    };

    return courseEntry;
})();

const sectionEntry = (() => {
    const sectionEntry = function (crnOr$element) {
        if (!(crnOr$element instanceof $)) {
            return sectionEntry.findByCrn(crnOr$element);
        }

        return new sectionEntry.prototype.Init(crnOr$element);
    };

    sectionEntry.prototype.Init = function ($element) {
        this.getElement = function () {
            return $element;
        };

        return this;
    };

    sectionEntry.prototype.Init.prototype = sectionEntry.prototype;

    sectionEntry.prototype.getCrn = function () {
        return this.getElement().data('crn');
    };

    sectionEntry.prototype.getName = function () {
        return this.getElement().data('section-name');
    };

    sectionEntry.prototype.getInstructorName = function () {
        return this.getElement().find('.instructor').text();
    };

    sectionEntry.prototype.instructorNameContains = function (query) {
        return this.getInstructorName().toUpperCase().indexOf(query) > -1;
    };

    sectionEntry.prototype.getGeneralName = function () {
        return this.getName().split(' ', 2).shift();
    };

    sectionEntry.prototype.getCourseCodeWithoutSpace = function () {
        return this.getName().replace(/([A-Z]+)(\d+).*/, '$1$2');
    };

    sectionEntry.prototype.isSelected = function () {
        return this.getElement().hasClass('selected');
    };

    sectionEntry.prototype.deselectAlternatives = function () {
        this.getElement().siblings('.selected').each((i, section) => sectionEntry($(section)).deselect());

        return this;
    };

    sectionEntry.prototype.addFilter = function (filterName) {
        this.getElement().addClass(`filter-hide-${filterName}`);

        return this;
    };

    sectionEntry.prototype.removeFilter = function (filterName) {
        this.getElement().removeClass(`filter-hide-${filterName}`);

        return this;
    };

    sectionEntry.prototype.getCourseEntry = function () {
        return courseEntry(this.getElement().parents('.course-entry'));
    };

    sectionEntry.prototype.getScheduleData = function () {
        return this.getElement().find('.section-day').map((i, el) => ({
            day: $(el).data('day'),
            start: $(el).data('start'),
            duration: $(el).data('duration'),
            place: $(el).data('place')
        })).toArray();
    };

    sectionEntry.prototype.getClassCells = function () {
        return classCells($(
            $.map(this.getScheduleData(), schedule =>
                $('#schedule tr').slice(schedule.start + 1, schedule.start + schedule.duration + 1)
                    .find(`td:eq(${schedule.day + 1})`).toArray()
            )
        ));
    };

    sectionEntry.prototype.select = function () {
        this.getElement().addClass('selected');

        this.deselectAlternatives();

        this.getCourseEntry().actOnSectionSelected();

        return this;
    };

    sectionEntry.prototype.deselect = function (shouldNotifyCourseEntry = true) {
        this.getElement().removeClass('selected');

        if (shouldNotifyCourseEntry) {
            this.getCourseEntry().actOnSectionDeselected();
        }

        return this;
    };

    sectionEntry.prototype.toggleSelect = function () {
        this.isSelected() ? this.deselect() : this.select();

        return this;
    };

    sectionEntry.findByCrn = crn => sectionEntry($(`.course-section[data-crn="${crn}"]:first`));

    sectionEntry.clearFilter = (filterName, checkForEmptySections = true) => {
        $('.course-section').removeClass(`filter-hide-${filterName}`);

        if (checkForEmptySections) courseEntry.filterIfAnyEmptySection();
    };

    sectionEntry.filter = (filter, filterName, checkForEmptySections = true) => {
        $('.course-section').each((i, section) => {
            section = sectionEntry($(section));

            filter(section) ? section.removeFilter(filterName) : section.addFilter(filterName);
        });

        if (checkForEmptySections) courseEntry.filterIfAnyEmptySection();
    };

    sectionEntry.filterByDays = () => {
        let allowedDays = [];

        $('#day-filter-selections input').each((i, checkbox) => {
            if ($(checkbox).is(':checked')) {
                allowedDays.push(i);
            }
        });

        //  TODO: Fix. This is a hack to always include courses with TBA days
        allowedDays.push(5);

        sectionEntry.filter(
            section => {
                for (const sectionDay of section.getElement().find('.section-day')) {
                    if (allowedDays.indexOf(Number($(sectionDay).data('day'))) === -1) {
                        return false;
                    }
                }

                return true;
            },
            'day'
        );
    };

    //  Maps every schedule cell that holds a course to the set of course codes sitting in it.
    //  Keys are `${row}-${column}` of #schedule, matching the arithmetic of getClassCells.
    sectionEntry.getOccupiedSlots = () => {
        const slots = {};

        $('.cell-course').each((i, element) => {
            const $cell = $(element).parent();
            const key = `${$cell.parent().index()}-${$cell.index()}`;
            const code = cellCourses($(element)).getCourseCodeWithoutSpace();

            (slots[key] = slots[key] || {})[code] = 1;
        });

        return slots;
    };

    sectionEntry.filterByConflicts = (() => {
        const apply = () => {
            if (!$('#conflict-filter-toggle').is(':checked')) {
                sectionEntry.clearFilter('conflict');

                return;
            }

            const occupiedSlots = sectionEntry.getOccupiedSlots();

            sectionEntry.filter(
                section => {
                    //  A selected section always stays visible, otherwise it could not be removed anymore.
                    if (section.isSelected()) {
                        return true;
                    }

                    const courseCode = section.getCourseCodeWithoutSpace();

                    for (const sectionDay of section.getElement().find('.section-day')) {
                        const day = Number($(sectionDay).data('day'));
                        const start = Number($(sectionDay).data('start'));
                        const duration = Number($(sectionDay).data('duration'));

                        //  TBA hours cannot conflict with anything
                        if (start === -1) {
                            continue;
                        }

                        for (let hour = start; hour < start + duration; hour++) {
                            const codes = occupiedSlots[`${hour + 1}-${day + 1}`];

                            if (codes === undefined) {
                                continue;
                            }

                            //  Hours taken by the section's own course are not a conflict.
                            for (const occupyingCode of Object.keys(codes)) {
                                if (occupyingCode !== courseCode) {
                                    return false;
                                }
                            }
                        }
                    }

                    return true;
                },
                'conflict'
            );
        };

        //  Adding a saved schedule fires one call per course, so consecutive calls are merged into one pass.
        let scheduledRun = null;

        return () => {
            if (scheduledRun !== null) {
                return;
            }

            scheduledRun = setTimeout(() => {
                scheduledRun = null;

                apply();
            }, 0);
        };
    })();

    return sectionEntry;
})();

const cellCourses = (() => {
    const cellCourses = function (crnOr$element) {
        if (!(crnOr$element instanceof $)) {
            return cellCourses.findByCrn(crnOr$element);
        }

        return new cellCourses.prototype.Init(crnOr$element);
    };

    cellCourses.prototype.Init = function ($elements) {
        this.getElements = function () {
            return $elements;
        };

        return this;
    };

    cellCourses.prototype.Init.prototype = cellCourses.prototype;

    cellCourses.prototype.getSectionName = function () {
        return this.getElements().first().data('section-name');
    };

    cellCourses.prototype.getCourseCodeWithSpace = function () {
        return this.getSectionName().replace(/([A-Z]+)(\d+).*/, '$1 $2');
    };

    cellCourses.prototype.getCourseCodeWithoutSpace = function () {
        return this.getSectionName().replace(/([A-Z]+)(\d+).*/, '$1$2');
    };

    cellCourses.prototype.getParentClassCells = function () {
        return classCells(this.getElements().parent());
    };

    cellCourses.prototype.isOfMainCourse = function () {
        return /^[A-Z]+\d+ .*$/.test(this.getSectionName());
    };

    cellCourses.prototype.animateCloseButtons = function (propagate = true) {
        if (propagate && this.isOfMainCourse()) {
            cellCourses.findByCourseCode(this.getCourseCodeWithoutSpace()).animateCloseButtons(false);
        }

        this.getElements().addClass('animate');

        return this;
    };

    cellCourses.prototype.getColor = function () {
        return this.getElements().first().css('background-color');
    };

    cellCourses.getAllCrnDataToCopy = () => {
        const crnObj = {};
        let results = [];

        $('.cell-course').each((i, element) => {
            const crn = $(element).data('crn');

            if (!crnObj.hasOwnProperty(crn)) {
                results.push(`${$(element).data('section-name')}: ${crn}`);
            }

            crnObj[$(element).data('crn')] = 1;
        });

        return results.sort().join('\n');
    };

    cellCourses.getAllCrnDataToSave = () => {
        const crnObj = {};

        $('.cell-course').each((i, element) => {
            crnObj[$(element).data('crn')] = 1;
        });

        return Object.keys(crnObj);
    };

    cellCourses.findByCrn = crn => cellCourses($(`.cell-course[data-crn="${crn}"]`));

    cellCourses.findByGeneralSectionName = name => cellCourses($(`.cell-course[data-section-name^="${name}"]`));

    cellCourses.findByCourseCode = code => cellCourses($(`.cell-course[data-section-name^="${code}"]`));

    cellCourses.make = (sectionName, crn, bgColor) => {
        return cellCourses($(templateGenerator.makeCellCourse(sectionName, crn, bgColor)));
    };

    return cellCourses;
})();

const classCells = (() => {
    const classCells = function (crnOr$elements) {
        if (!(crnOr$elements instanceof $)) {
            return classCells.findContainsCrn(crnOr$elements)
        }

        return new classCells.prototype.Init(crnOr$elements);
    };

    classCells.prototype.Init = function ($elements) {
        this.getElements = function () {
            return $elements;
        };

        return this;
    };

    classCells.prototype.Init.prototype = classCells.prototype;

    classCells.prototype.getElementsByChildrenCount = function (count) {
        return $(
            $.map(this.getElements(), element => {
                if ($(element).children().length === count) {
                    return element;
                }
            })
        );
    };

    classCells.prototype.addCellCourse = function (cellCourse) {
        this.getElements().addClass('filled').append(cellCourse.getElements().first().clone());

        this.getElementsByChildrenCount(1).addClass('make-available');

        return this;
    };

    classCells.prototype.removeCellCourse = function (crn) {
        cellCourses.findByCrn(crn).getElements().remove();

        this.getElementsByChildrenCount(0).removeClass('filled');

        return this;
    };

    classCells.clearInterests = () => {
        $('.interested').removeClass('interested').removeClass('make-available');
    };

    classCells.findContainsCrn = crn => classCells($('.class-cell').has(`[data-crn="${crn}"]`));

    return classCells;
})();

const icsExport = (() => {
    //  Turkey has been on a fixed UTC+3 since 2016, so the zone needs a single rule.
    const timeZone = [
        'BEGIN:VTIMEZONE',
        'TZID:Europe/Istanbul',
        'BEGIN:STANDARD',
        'DTSTART:19700101T000000',
        'TZOFFSETFROM:+0300',
        'TZOFFSETTO:+0300',
        'TZNAME:+03',
        'END:STANDARD',
        'END:VTIMEZONE'
    ];

    //  Backslash first, otherwise the escapes we add below get escaped again.
    const escapeText = text => String(text)
        .replace(/\\/g, '\\\\')
        .replace(/;/g, '\\;')
        .replace(/,/g, '\\,')
        .replace(/\r?\n/g, '\\n');

    //  RFC 5545 counts octets, not characters: a Turkish letter is two bytes in UTF-8,
    //  so folding by character length would still emit over-long lines.
    const foldLine = (() => {
        const encoder = new TextEncoder();

        return line => {
            const pieces = [];

            let piece = '';
            let octets = 0;
            let limit = 75;

            for (const character of line) {
                const size = encoder.encode(character).length;

                if (octets + size > limit) {
                    pieces.push(piece);

                    piece = '';
                    octets = 0;
                    //  Continuation lines spend one of their 75 octets on the leading space.
                    limit = 74;
                }

                piece += character;
                octets += size;
            }

            pieces.push(piece);

            return pieces.join('\r\n ');
        };
    })();

    const pad = number => `${number < 10 ? '0' : ''}${number}`;

    //  All date maths is done in UTC so the browser's own zone can never shift a day.
    const parseMonday = value => {
        const [year, month, day] = value.split('-').map(Number);
        const date = new Date(Date.UTC(year, month - 1, day));

        date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));

        return date;
    };

    const formatLocal = (monday, dayCode, hour, minute) => {
        const date = new Date(monday);

        date.setUTCDate(date.getUTCDate() + dayCode);

        return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
            `T${pad(hour)}${pad(minute)}00`;
    };

    const stamp = () => {
        const now = new Date();

        return `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}` +
            `T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`;
    };

    //  Sourced from courses whose selection is complete rather than from the .cell-course
    //  elements: a fully TBA section occupies no schedule cell, so reading the table back
    //  would silently drop those courses instead of reporting them. isSelectionComplete is
    //  what keeps half-picked courses out, which plain .selected would wrongly include.
    const collect = () => {
        const events = [];

        let skipped = 0;

        $('.course-entry').each((i, element) => {
            const course = courseEntry($(element));

            if (!course.isSelectionComplete()) {
                return;
            }

            const title = course.getName().split(' - ').slice(1).join(' - ');

            course.getSections('.course-section.selected').forEach(section => {
                section.getScheduleData().forEach(schedule => {
                    if (schedule.start === -1 || schedule.day === 5) {
                        skipped++;

                        return;
                    }

                    events.push({
                        crn: section.getCrn(),
                        day: schedule.day,
                        start: schedule.start,
                        duration: schedule.duration,
                        place: schedule.place,
                        summary: `${section.getName()} — ${title}`,
                        instructor: section.getInstructorName()
                    });
                });
            });
        });

        return {events, skipped};
    };

    const build = (events, monday, weeks) => {
        const lines = [
            'BEGIN:VCALENDAR',
            'VERSION:2.0',
            'PRODID:-//SUchedule//SUchedule//EN',
            'CALSCALE:GREGORIAN',
            'METHOD:PUBLISH',
            ...timeZone
        ];

        const dtstamp = stamp();

        events.forEach(event => {
            lines.push(
                'BEGIN:VEVENT',
                //  Stable per class hour, so re-importing updates instead of duplicating.
                `UID:${event.crn}-${event.day}-${event.start}@suchedule`,
                `DTSTAMP:${dtstamp}`,
                `DTSTART;TZID=Europe/Istanbul:${formatLocal(monday, event.day, event.start + 8, 40)}`,
                `DTEND;TZID=Europe/Istanbul:${formatLocal(monday, event.day, event.start + 8 + event.duration, 30)}`,
                `RRULE:FREQ=WEEKLY;COUNT=${weeks}`,
                `SUMMARY:${escapeText(event.summary)}`,
                `LOCATION:${escapeText(event.place)}`,
                `DESCRIPTION:${escapeText(`CRN: ${event.crn}\nInstructor: ${event.instructor}`)}`,
                'END:VEVENT'
            );
        });

        lines.push('END:VCALENDAR');

        //  CRLF is not optional: Outlook rejects a calendar that only uses \n.
        return `${lines.map(foldLine).join('\r\n')}\r\n`;
    };

    const download = text => {
        const url = URL.createObjectURL(new Blob([text], {type: 'text/calendar;charset=utf-8'}));
        const $link = $('<a>').attr({href: url, download: `suchedule-${terms.getActive()}.ics`});

        $('body').append($link);

        $link[0].click();
        $link.remove();

        URL.revokeObjectURL(url);
    };

    const message = text => $('#export-message').text(text);

    const run = () => {
        const startDate = $('#term-start-date').val();

        if (!startDate) {
            message('Pick the Monday your classes start.');

            return;
        }

        const weeks = Math.min(Math.max(Number($('#week-count').val()) || 14, 1), 20);
        const {events, skipped} = collect();

        if (events.length === 0) {
            message(skipped > 0
                ? 'Every class hour on your schedule is TBA, so there is nothing to export.'
                : 'Add some courses to your schedule first.');

            return;
        }

        download(build(events, parseMonday(startDate), weeks));

        message(`Downloaded ${events.length} event${events.length === 1 ? '' : 's'} over ${weeks} weeks.` +
            (skipped > 0 ? ` ${skipped} TBA class hour${skipped === 1 ? '' : 's'} left out.` : ''));
    };

    return {escapeText, foldLine, collect, build, parseMonday, run};
})();

const shareLink = (() => {
    const make = () => {
        const crns = cellCourses.getAllCrnDataToSave();

        return `${location.origin}${location.pathname}#term=${terms.getActive()}&crns=${crns.join(',')}`;
    };

    const parse = () => {
        const crnsMatch = location.hash.match(/crns=([\d,]+)/);
        const termMatch = location.hash.match(/term=(\d+)/);

        if (crnsMatch === null) {
            return null;
        }

        return {
            term: termMatch === null ? null : termMatch[1],
            //  A repeated crn would click the same section twice and toggle it back off.
            crns: [...new Set(crnsMatch[1].split(',').filter(crn => crn.length > 0))]
        };
    };

    //  A shared schedule gets its own plan, so nothing the visitor built is touched.
    //  Only when every plan slot is taken does it fall back to replacing the active one.
    const resolveTarget = () => {
        if (scenarios.count() < scenarios.MAX) {
            return {isNew: true, name: scenarios.nextName()};
        }

        const index = scenarios.getActiveIndex();

        return {isNew: false, name: scenarios.getName(index), courses: scenarios.crnCount(index)};
    };

    const notify = (id, text) => {
        $(`#${id} .notification-content p`).text(text);

        $(`#${id}`).fadeIn(500);
    };

    let pending = null;

    const targetSentence = () => {
        const target = resolveTarget();

        return target.isNew
            ? ` Load it into a new plan (${target.name})?`
            : ` All ${scenarios.MAX} plans are in use, so this will replace ${target.name}` +
              ` (${target.courses} course${target.courses === 1 ? '' : 's'}). Load it anyway?`;
    };

    //  Called once the course list is on the page. Before multi-term this refused any link
    //  from another term; now a term the app still carries is simply switched to.
    const offerImport = () => {
        const shared = parse();

        if (shared === null) {
            return;
        }

        if (shared.term !== null && !terms.has(shared.term)) {
            notify('notify-share-invalid',
                `This link is for term ${shared.term}, which SUchedule no longer carries.` +
                ` Ask for a link from ${terms.getList().map(entry => terms.getLabel(entry.term)).join(' or ')}.`);

            return;
        }

        pending = shared;

        //  A link for another term cannot be checked against the list on screen, so the
        //  crns are verified after the switch instead.
        if (shared.term !== null && shared.term !== terms.getActive()) {
            notify('notify-share-import',
                `Someone shared a ${terms.getLabel(shared.term)} schedule of ${shared.crns.length}` +
                ` course${shared.crns.length === 1 ? '' : 's'} with you.` +
                ` Switch to that term and load it into a new plan?`);

            return;
        }

        const found = shared.crns.filter(crn => $(`.course-section[data-crn="${crn}"]`).length > 0);
        const missing = shared.crns.length - found.length;

        if (found.length === 0) {
            pending = null;

            notify('notify-share-invalid',
                `None of the ${shared.crns.length} courses in this link exist in ${terms.getLabel(terms.getActive())}.`);

            return;
        }

        notify('notify-share-import',
            `Someone shared a schedule of ${found.length} course${found.length === 1 ? '' : 's'} with you.` +
            `${missing > 0 ? ` ${missing} of them could not be found in this term.` : ''}` +
            targetSentence());
    };

    const applyImport = crns => {
        const found = crns.filter(crn => $(`.course-section[data-crn="${crn}"]`).length > 0);

        if (found.length === 0) {
            notify('notify-share-invalid', 'None of the courses in that link exist in this term.');

            return;
        }

        //  Resolved again rather than reused: the visitor may have added or closed a plan
        //  while the confirmation was sitting on screen.
        resolveTarget().isNew ? scenarios.add(found.join(',')) : scenarios.replaceActive(found.join(','));

        if (found.length < crns.length) {
            notify('notify-share-invalid',
                `${crns.length - found.length} of the shared courses could not be found in this term.`);
        }
    };

    const acceptImport = () => {
        if (pending === null) {
            return;
        }

        const shared = pending;

        pending = null;

        //  Without this the confirmation comes back on every reload and fights the user's own edits.
        history.replaceState(null, '', location.pathname);

        if (shared.term !== null && shared.term !== terms.getActive()) {
            switchTerm(shared.term).then(() => applyImport(shared.crns));

            return;
        }

        applyImport(shared.crns);
    };

    return {make, parse, offerImport, acceptImport};
})();

(showFirstVisitNotifications = () => {
    if (localStorage.getItem('visited-before') === null) {
        localStorage.setItem('visited-before', 'yes');

        //  One greeting rather than two stacked windows: #notify-about already covers what
        //  the app is, where the data is kept and where the credit figures come from.
        $('#notify-about').show();
    }
})();

//  populate builds brand new .course-entry elements with no filter-hide classes on them,
//  so after any repopulation every filter has to run again or the controls will show a
//  filter as active while the list plainly ignores it.
const creditFilter = (() => {
    const storageKey = 'credit-filter';

    const metrics = [
        {key: 'cr', label: 'SU credit'},
        {key: 'ects', label: 'ECTS'},
        {key: 'eng', label: 'Engineering'},
        {key: 'bsc', label: 'Basic Science'}
    ];

    //  bounds[key] = {max, raw}. max is where the slider ends, raw is the largest value
    //  in the data; when they differ the top handle means "and above".
    let bounds = {};
    let state = {};

    const defaultState = () => {
        const fresh = {showUnknown: true};

        metrics.forEach(metric => fresh[metric.key] = [0, bounds[metric.key].max]);

        return fresh;
    };

    //  A slider needs a usable ceiling, and neither extreme works on its own. Hardcoding
    //  it from the undergraduate catalog would cap ECTS at 7 and quietly drop every
    //  graduate course; using the raw maximum would set ECTS to 180, because thesis
    //  courses carry that, squeezing 91% of courses into the first few pixels.
    //
    //  So: take the smallest value covering 90% of courses, and trim to it only when the
    //  raw maximum is both more than twice that AND large in absolute terms. The absolute
    //  guard matters - once missing engineering and basic science credits are stored as 0,
    //  those metrics are 79% zeros and the 90% mark collapses to 2, which would have
    //  trimmed a 0-7 range down to 0-2 and pushed MATH 101 (basic 6) into the open bucket.
    //  Below about a dozen steps a linear slider reads fine, so nothing there is trimmed.
    const SLIDER_LIMIT = 12;

    const deriveBound = values => {
        if (values.length === 0) {
            return {max: 0, raw: 0};
        }

        const sorted = values.slice(0).sort((left, right) => left - right);
        const raw = sorted[sorted.length - 1];
        const cover = sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.9) - 1)];

        return {max: raw > cover * 2 && raw > SLIDER_LIMIT ? cover : raw, raw};
    };

    const readValues = key => $('.course-entry').toArray()
        .map(element => $(element).attr(`data-${key}`))
        .filter(value => value !== '' && value !== undefined)
        .map(Number);

    const unknownCourses = () => $('.course-entry').toArray()
        .filter(element => metrics.some(metric => $(element).attr(`data-${metric.key}`) === ''))
        .map(element => $(element).data('code'));

    const clampState = () => {
        metrics.forEach(metric => {
            const limit = bounds[metric.key].max;
            const range = state[metric.key] || [0, limit];

            let [low, high] = range.map(Number);

            low = Math.min(Math.max(low, 0), limit);
            high = Math.min(Math.max(high, 0), limit);

            state[metric.key] = [Math.min(low, high), Math.max(low, high)];
        });

        state.showUnknown = state.showUnknown !== false;
    };

    const save = () => localStorage.setItem(storageKey, JSON.stringify(state));

    const isAtFullRange = () => state.showUnknown &&
        metrics.every(metric => state[metric.key][0] === 0 && state[metric.key][1] === bounds[metric.key].max);

    //  Only the labels and the status line. Rebuilding the inputs here would pull the
    //  element out from under a drag in progress, which breaks the slider mid-gesture.
    const refresh = () => {
        //  Guards the calls that come from the filter pipeline during boot, before
        //  recalculate has had a term to measure.
        if (metrics.some(metric => bounds[metric.key] === undefined || state[metric.key] === undefined)) {
            return;
        }

        metrics.forEach(metric => {
            const [low, high] = state[metric.key];
            const bound = bounds[metric.key];
            const $metric = $(`.credit-metric[data-metric="${metric.key}"]`);

            $metric.find('.credit-metric-value')
                .text(`${low} \u2013 ${high}${high >= bound.max && bound.raw > bound.max ? '+' : ''}`);

            const span = bound.max || 1;

            $metric.find('.credit-fill').css({
                left: `${(low / span) * 100}%`,
                right: `${100 - (high / span) * 100}%`
            });

            //  With both thumbs pinned to the same end the upper one would sit on top and
            //  swallow the drag, leaving the range stuck. Lift the lower one out at the top.
            $metric.toggleClass('min-on-top', low >= bound.max);
        });

        const remaining = $('.course-entry:not([class*=filter-hide-])').length;

        $('#credit-filter').toggleClass('narrowed', !isAtFullRange());

        //  Always shown, filtered or not: the count answers "how much is left" whether or
        //  not this particular panel is what narrowed it, and every filter feeds into it.
        $('#credit-filter-status')
            .text(`${remaining} course${remaining === 1 ? '' : 's'}`)
            .attr('title', 'Courses still shown with every filter applied');
    };

    //  The full rebuild, only where the inputs themselves have to change: new bounds
    //  after a term switch, or a reset.
    const render = () => {
        $('#credit-filter-metrics').html(metrics.map(metric =>
            templateGenerator.makeCreditMetric(metric, bounds[metric.key], state[metric.key])).join(''));

        $('#credit-filter-unknown').prop('checked', state.showUnknown);

        const unknown = unknownCourses();

        //  Naming them matters: "2 courses have no catalog data" invites exactly one
        //  question, and the answer is a click away rather than a support conversation.
        $('#credit-filter-missing')
            .toggle(unknown.length > 0)
            .removeClass('open')
            .find('#credit-filter-missing-summary')
            .text(`${unknown.length} course${unknown.length === 1 ? '' : 's'} with no catalog data`);

        $('#credit-filter-missing-list').text(unknown.join(', '));

        refresh();
    };

    //  Called after every repopulation: another term can have a different ceiling, and a
    //  selection saved under the old one has to be pulled inside the new one or the list
    //  comes back empty with no visible reason.
    const recalculate = () => {
        metrics.forEach(metric => bounds[metric.key] = deriveBound(readValues(metric.key)));

        try {
            state = JSON.parse(localStorage.getItem(storageKey)) || defaultState();
        } catch (error) {
            state = defaultState();
        }

        clampState();
        save();
        render();
    };

    const setRange = (key, low, high) => {
        state[key] = [Number(low), Number(high)];

        clampState();
        save();
    };

    const setShowUnknown = value => {
        state.showUnknown = value;

        save();
    };

    const reset = () => {
        state = defaultState();

        save();
        render();
    };

    //  == null and never a truthy test: 0 is a stated zero, null is the catalog saying
    //  nothing. `null >= 0` is true in JS, so a naive range check silently keeps them.
    const matches = element => {
        const $entry = $(element);

        return metrics.every(metric => {
            const raw = $entry.attr(`data-${metric.key}`);

            if (raw === '' || raw === undefined) {
                return state.showUnknown;
            }

            const value = Number(raw);
            const [low, high] = state[metric.key];

            //  The top handle is open ended wherever the slider was trimmed, so a 180 ECTS
            //  dissertation is never excluded just for sitting past the end of the track.
            return value >= low && (high >= bounds[metric.key].max ? true : value <= high);
        });
    };

    const getBounds = () => bounds;

    const getState = () => state;

    return {metrics, recalculate, render, refresh, setRange, setShowUnknown, reset, isAtFullRange, matches, getBounds, getState};
})();

const applyAllFilters = () => {
    sectionEntry.filterByDays();

    courseEntry.filterByLevel();

    courseEntry.filterByCredits();

    sectionEntry.filterByConflicts();

    $('#search-box').trigger('input');
};

const switchTerm = term => {
    terms.setActive(term);
    terms.updateNotice();

    $('#term-select').val(term);

    if (courseEntry.isOnDisplayMode()) {
        courseEntry.endDisplayMode();
    }

    //  Reset without saving: writing here would overwrite the target term with an empty plan.
    scenarios.clearScheduleDom();

    $('#course-list').empty().addClass('loading');

    return courseData.load(term).then(data => {
        courseEntry.populate(data.courses, data.instructors, data.places, term);

        scenarios.loadForActiveTerm();
        scenarios.renderTabs();
        scenarios.switchTo(scenarios.getActiveIndex());

        //  Before applyAllFilters: the new term can have a different ceiling and the saved
        //  selection has to be clamped into it first.
        creditFilter.recalculate();

        applyAllFilters();
    });
};

(setLevelFilterEvents = () => {
    const storageKey = 'level-filter';
    const mode = localStorage.getItem(storageKey) || 'all';

    $(`input[name=level-filter][value="${mode}"]`).prop('checked', true);

    $(document).on('change', 'input[name=level-filter]', event => {
        localStorage.setItem(storageKey, $(event.currentTarget).val());

        courseEntry.filterByLevel();
    });

    //  Covers the repeat visit, where updateCourseData has already populated the list synchronously.
    courseEntry.filterByLevel();
})();

const normalizeSearchParam = (query) => {
        query = query.trim().toUpperCase();
        query = query.replaceAll(/\s+/g, '');
        
        return query;
};

(setEvents = () => {
    let draggedIndex = null;

    $(document).on('click', '.course-header', event => {
        courseEntry($(event.currentTarget).parent()).toggleOpen();

        if (courseEntry.isOnDisplayMode()) {
            courseEntry.endDisplayMode();
        }
    });

    $(document).on('click', '.section-link', event => {
        event.stopPropagation();
    });

    $(document).on('click', '.course-section', event => {
        sectionEntry($(event.currentTarget)).toggleSelect();
    });

    $(document).on('click', '.remove-course', event => {
        sectionEntry($(event.currentTarget).parent().data('crn')).toggleSelect();

        event.stopPropagation();
    });

    $(document).on('mouseenter', '.remove-course,.course-section.selected', event => {
        cellCourses($(event.currentTarget).closest('[data-crn]').data('crn')).animateCloseButtons();
    });

    $(document).on('mouseleave', '.remove-course,.course-section.selected', event => {
        $('.cell-course.animate').removeClass('animate');

        event.stopPropagation();
    });

    $(document).on('click', '.cell-course', event => {
        courseEntry.startDisplayMode(cellCourses($(event.currentTarget)).getCourseCodeWithSpace());
    });

    $(document).on('mouseenter', '.course-section', event => {
        const section = sectionEntry($(event.currentTarget));

        section.getClassCells().getElements().addClass('interested');

        cellCourses.findByGeneralSectionName(section.getGeneralName()).getParentClassCells().getElements()
            .filter('.interested').addClass('make-available');
    });

    $(document).on('mouseleave', '.course-section', () => {
        classCells.clearInterests();
    });

    const searchParameterChange = event => {
        courseEntry.closeAll();

        const filterName = 'search';

        const searchQuery = (normalizeSearchParam($('#search-box').val() || '') || '');

        switch ($('#search-category').val()) {
            case 'name':
                courseEntry.filter(
                    course => course.nameContains(searchQuery),
                    filterName
                );
                sectionEntry.clearFilter(filterName);
                break;
            case 'instructor':
                courseEntry.clearFilter(filterName);
                sectionEntry.filter(
                    section => section.instructorNameContains(searchQuery),
                    filterName
                );
                break;
        }
    };

    $('#search-category').on('change', searchParameterChange);

    $('#search-box').on('input', searchParameterChange);

    $('#term-select').on('change', event => switchTerm($(event.currentTarget).val()));

    $(document).on('click', '#credit-filter-header', () => $('#credit-filter').toggleClass('open'));

    //  Two inputs stand for one range, so they have to be stopped from crossing by hand -
    //  the browser will happily let the minimum run past the maximum.
    $(document).on('input', '.credit-metric input', event => {
        const $metric = $(event.currentTarget).closest('.credit-metric');
        const $min = $metric.find('.credit-min');
        const $max = $metric.find('.credit-max');

        if (Number($min.val()) > Number($max.val())) {
            $(event.currentTarget).hasClass('credit-min')
                ? $max.val($min.val())
                : $min.val($max.val());
        }

        creditFilter.setRange($metric.data('metric'), $min.val(), $max.val());

        courseEntry.filterByCredits();
    });

    $(document).on('input', '#credit-filter-unknown', event => {
        creditFilter.setShowUnknown($(event.currentTarget).is(':checked'));

        courseEntry.filterByCredits();
    });

    $(document).on('click', '#credit-filter-missing-summary', () => {
        $('#credit-filter-missing').toggleClass('open');
    });

    $(document).on('click', '#credit-filter-reset', event => {
        event.stopPropagation();

        creditFilter.reset();

        courseEntry.filterByCredits();
    });

    $('#menu-toggle').on('click', () => $('body').toggleClass('hide-menu'));

    //  Pasting a share link while already on the site only changes the hash, so the page
    //  never reloads and populate never runs again.
    $(window).on('hashchange', () => shareLink.offerImport());

    $(document).on('click', '#export-button', () => {
        $('#export-message').text('');

        $('#export-modal').modal();
    });

    $(document).on('click', '#download-ics-button', () => icsExport.run());

    //  Bound straight to the element on purpose: ClipboardJS delegates from document.body,
    //  so stopping propagation here is what keeps an empty schedule from being copied.
    $('#share-button').on('click', event => {
        if (cellCourses.getAllCrnDataToSave().length > 0) {
            return;
        }

        event.stopPropagation();

        $('#notify-share-empty').fadeIn(500);
    });

    $(document).on('keyup', (() => {
        const ESC_KEY = 27;

        return event => {
            if (event.keyCode === ESC_KEY) {
                if (courseEntry.isOnDisplayMode()) {
                    courseEntry.endDisplayMode();
                } else {
                    $('#search-box').val('').trigger('input');
                }
            }
        };
    })());

    //  Skipping the already active tab is what lets dblclick-to-rename work: re-running
    //  switchTo on every click would be harmless, but a second click must not race the rename.
    $(document).on('click', '.scenario-tab', event => {
        const index = Number($(event.currentTarget).data('scenario'));

        if (index !== scenarios.getActiveIndex()) {
            scenarios.switchTo(index);
        }
    });

    $(document).on('click', '#scenario-add', () => scenarios.add());

    $(document).on('click', '.scenario-tab-close', event => {
        event.stopPropagation();

        scenarios.requestClose(Number($(event.currentTarget).closest('.scenario-tab').data('scenario')));
    });

    $(document).on('dblclick', '.scenario-tab-name', event => {
        //  Dragging inside a contenteditable has to select text, not reorder the tab.
        $(event.currentTarget).closest('.scenario-tab').attr('draggable', 'false');

        $(event.currentTarget).attr('contenteditable', 'true').focus();

        document.execCommand('selectAll', false, null);
    });

    $(document).on('dragstart', '.scenario-tab', event => {
        draggedIndex = Number($(event.currentTarget).data('scenario'));

        //  Firefox refuses to start a drag unless some data is set.
        event.originalEvent.dataTransfer.setData('text/plain', String(draggedIndex));
        event.originalEvent.dataTransfer.effectAllowed = 'move';

        $(event.currentTarget).addClass('dragging');
    });

    $(document).on('dragover', '.scenario-tab', event => {
        if (draggedIndex === null) {
            return;
        }

        event.preventDefault();

        event.originalEvent.dataTransfer.dropEffect = 'move';

        const index = Number($(event.currentTarget).data('scenario'));

        $('.scenario-tab').removeClass('drop-before drop-after');

        if (index !== draggedIndex) {
            $(event.currentTarget).addClass(index < draggedIndex ? 'drop-before' : 'drop-after');
        }
    });

    $(document).on('drop', '.scenario-tab', event => {
        event.preventDefault();

        if (draggedIndex !== null) {
            scenarios.move(draggedIndex, Number($(event.currentTarget).data('scenario')));
        }
    });

    $(document).on('dragend', '.scenario-tab', () => {
        draggedIndex = null;

        $('.scenario-tab').removeClass('dragging drop-before drop-after');
    });

    $(document).on('blur', '.scenario-tab-name[contenteditable]', event => {
        const $name = $(event.currentTarget);

        $name.removeAttr('contenteditable');

        scenarios.rename(Number($name.closest('.scenario-tab').data('scenario')), $name.text());
    });

    $(document).on('keydown', '.scenario-tab-name[contenteditable]', event => {
        if (event.key === 'Enter') {
            event.preventDefault();

            $(event.currentTarget).blur();
        }

        if (event.key === 'Escape') {
            //  Drop the attribute first so the blur handler above no longer matches and
            //  the half typed name is discarded instead of saved.
            $(event.currentTarget).removeAttr('contenteditable');

            scenarios.renderTabs();
        }
    });

    $(document).on('click', '#clear-button', () => {
        $('#notify-clear .notification-content p')
            .text(`Are you sure you want to clear ${scenarios.getActiveName()}?`);

        $('#notify-clear').fadeIn(500);
    });

    $(document).on('click', '#about-button', () => $('#notify-about').fadeIn(500));
})();

(setWeekdayFilterEvents = () => {
    $(document).on('input', '#day-filter-selections input', event => {
        sectionEntry.filterByDays();
    });

    if ($('#day-filter-selections input:not(:checked)').length > 0) {
        sectionEntry.filterByDays();

        $('#day-filter-selections').show();
    }
})();

(setConflictFilterEvents = () => {
    const storageKey = 'hide-conflicting-courses';

    //  The state has to be restored before the saved schedule is loaded, otherwise
    //  the courses added on load would be filtered against a toggle that looks off.
    $('#conflict-filter-toggle').prop('checked', localStorage.getItem(storageKey) === 'yes');

    $(document).on('input', '#conflict-filter-toggle', event => {
        localStorage.setItem(storageKey, $(event.currentTarget).is(':checked') ? 'yes' : 'no');

        sectionEntry.filterByConflicts();
    });
})();

//  The whole boot is asynchronous now: terms.json decides which data file to fetch, so
//  nothing that touches the course list can run before this resolves.
(loadTermsAndSchedule = () => {
    $.getJSON('terms.json').then(data => {
        terms.setList(data.terms);
        terms.renderSelect();

        scenarios.migrateLegacy(terms.getCurrent());

        const outdated = terms.clearOutdated();

        if (outdated.length > 0) {
            $('#notify-data-updated .notification-content p').text(
                `The courses for ${outdated.map(terms.getLabel).join(' and ')} changed, so the plans saved` +
                ` for ${outdated.length === 1 ? 'that term' : 'those terms'} were cleared.`
            );

            $('#notify-data-updated').fadeIn(500);
        }

        return switchTerm(terms.getActive());
    }).then(() => shareLink.offerImport()).fail(() => {
        //  Without terms.json there is no data file to fetch. Its own notification rather
        //  than the shared-link one, whose heading reads "Link Not Usable" and would send
        //  someone looking for a problem with a link they never opened.
        $('#course-list').removeClass('loading');

        $('#notify-load-failed').fadeIn(500);
    });
})();

(setNotificationEvents = () => {
    $(document).on('click', '.notification .button', event => {
        $(event.target).closest('.notification').fadeOut(500);
    });

    $(document).on('click', '#notify-share-import .notification-button', () => {
        shareLink.acceptImport();
    });

    $(document).on('click', '#notify-load-failed .notification-button', () => location.reload());

    $(document).on('click', '#notify-close-plan .notification-button', () => {
        scenarios.confirmClose();
    });

    $(document).on('click', '#notify-clear .notification-button', () => {
        scenarios.clearScheduleDom();

        saveSchedule();

        sectionEntry.filterByConflicts();

        creditTotals.update();
    });
})();

(initializeClipboardJS = () => {
    const clipboard = new ClipboardJS('#copy-button', {
        text: () => cellCourses.getAllCrnDataToCopy()
    });

    clipboard.on('success', () => {
        const notification = $('#notify-copied');

        notification.fadeIn(500);

        setTimeout(() => {
            notification.fadeOut(500);
        }, 2000);
    });

    clipboard.on('error', event => {
        const notification = $('#notify-copy-fail');

        notification.find('.notification-content p').text(event.text);

        notification.fadeIn(500);
    });

    const shareClipboard = new ClipboardJS('#share-button', {
        text: () => shareLink.make()
    });

    shareClipboard.on('success', () => {
        const notification = $('#notify-share-copied');

        notification.fadeIn(500);

        setTimeout(() => {
            notification.fadeOut(500);
        }, 3000);
    });

    shareClipboard.on('error', event => {
        const notification = $('#notify-copy-fail');

        notification.find('.notification-content p').text(event.text);

        notification.fadeIn(500);
    });
})();
