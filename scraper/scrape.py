from typing import List, Dict

import requests
import json
import sys
import re
import time

from bs4 import BeautifulSoup


class SUcheduleCourseScraper:
    def __init__(self, term: int):
        self.term = term
        self.instructors = []
        self.places = []
        self.catalog_cache = {}
        #  492 catalog fetches over one connection instead of 492 handshakes.
        self.session = requests.Session()

    @staticmethod
    def to_number(text):
        """
        '3.000' -> 3, '1.500' -> 1.5, anything unparsable -> None.
        Credits are kept numeric so the front end never has to parse strings, and
        unknown stays None rather than 0 - a real 0 is information, a missing
        value is not.
        """
        try:
            value = float(text)
        except (TypeError, ValueError):
            return None

        return int(value) if value == int(value) else value

    def run(self) -> None:
        """
        Run required flow for getting course schedule and saving to a .json file
        """
        course_codes = self.get_course_codes()
        print("Course codes are fetched.")
        course_datas = self.get_courses_data(codes=course_codes)
        print("Course data is fetched.")
        self.write_json_file(courses=course_datas,places=self.places,instructors=self.instructors)
        print("Json file is created.")

    def get_course_codes(self) -> List[str]:
        """
        Get courses code from bannerweb.
        """

        # Sets header and payload
        payload = {'p_calling_proc': 'bwckschd.p_disp_dyn_sched', 'p_term': self.term}
        headers = {'Content-type': 'application/x-www-form-urlencoded'}

        # Sends request to bannerweb
        data = self.session.post(f"https://suis.sabanciuniv.edu/prod/bwckgens.p_proc_term_date",
                             data=payload, headers=headers, timeout=60)

        # Parses html and catches course codes
        source = BeautifulSoup(data.content, 'html.parser')
        course_codes: List[str] = [course.get("value") for course in source.find_all('option')]

        # Removes unnecessary elements
        course_codes = [code for code in course_codes if code.isupper() and code.isalpha()]

        # Insert dummy element to codes list first position
        course_codes.insert(0, "dummy")

        return course_codes

    def get_courses_data(self, codes: List[str]) -> List:
        """
        Get courses data from bannerweb.
        :return:
            str
        """
        course_informations: List[Dict] = []
        payload = {'term_in': self.term, 'sel_subj': codes, 'sel_day': 'dummy', 'sel_schd': 'dummy',
                   'sel_insm': 'dummy', 'sel_camp': 'dummy', 'sel_levl': 'dummy', 'sel_sess': 'dummy',
                   'sel_instr': 'dummy', 'sel_ptrm': 'dummy', 'sel_attr': 'dummy', 'sel_crse': '', 'sel_title': '',
                   'sel_from_cred': '', 'sel_to_cred': '', 'begin_hh': '0', 'begin_mi': '0', 'begin_ap': 'a',
                   'end_hh': '0', 'end_mi': '0', 'end_ap': 'a'}
        headers = {'Content-type': 'application/x-www-form-urlencoded'}

        # Sends request to bannerweb
        data = self.session.post(f"https://suis.sabanciuniv.edu/prod/bwckschd.p_get_crse_unsec",
                             data=payload, headers=headers, timeout=60)

        # Parses html and catches course title, crn code, course code and section code
        source = BeautifulSoup(data.content, 'html.parser')
        courses: List = source.find_all("th", attrs={"class": "ddlabel"})

        # Get course information
        for course in courses:
            course_information = self.get_course_information(course)

            if course_information["section"]:
                course_informations.append(course_information)
            else:
                print(f"Course {course_information['name']} has no section.")

        # Edit course information for json file
        return self.set_course_informations(course_informations)

    def get_course_information(self, course: BeautifulSoup) -> Dict:
        """
        Get course information from a course tag.
        """
        # Catch course name, crn code, course code and section code
        title = course.find("a").text.split("-")

        # Catch course sections
        next_sibling = course.parent.find_next_sibling("tr")

        #  Unknown stays None all the way through; only the front end turns it into "N/A".
        credits_value = None
        ects_credits = None
        eng_credits = None
        basic_credits = None

        if next_sibling is not None:
            #  Fractional credits exist (1.500 Credits), so match the number rather
            #  than truncating at the decimal point.
            credits_match = re.search(r"([\d.]+)\s+Credits", next_sibling.get_text())
            if credits_match:
                credits_value = self.to_number(credits_match.group(1))

            catalog_link_tag = next_sibling.find("a", string=re.compile("View Catalog Entry", re.IGNORECASE))
            if catalog_link_tag:
                catalog_url = "https://suis.sabanciuniv.edu" + catalog_link_tag.get("href")
                #  Normalised, otherwise CS 201 and CS 201R cache separately and the
                #  same catalog page is fetched twice.
                course_code_key = self.set_course_code(title[-2])

                if course_code_key in self.catalog_cache:
                    ects_credits, eng_credits, basic_credits = self.catalog_cache[course_code_key]
                else:
                    ects_credits, eng_credits, basic_credits = self.get_catalog_details(catalog_url)

                    #  The Banner catalog leaves the breakdown off some courses entirely,
                    #  but the course page carries it - EE 48010 reads 4 / 2 there and
                    #  nothing at all on the catalog page. Only asked when the catalog
                    #  came back empty, so it costs one extra request per gap.
                    if eng_credits is None and basic_credits is None:
                        page_ects, page_eng, page_basic = self.get_coursepage_details(course_code_key)

                        if page_eng is not None or page_basic is not None:
                            eng_credits, basic_credits = page_eng, page_basic

                        if ects_credits is None:
                            ects_credits = page_ects

                    self.catalog_cache[course_code_key] = (ects_credits, eng_credits, basic_credits)
                    # Be polite to the server
                    time.sleep(0.1)

        if next_sibling is not None and next_sibling.find("table") is not None:
            table = [item for item in next_sibling.find("table").find_all("tr") if item.find("td")]
            sections = [row.find_all("td") for row in table]
        else:
            sections = []

        # Add values to dictionary
        course_information = {
            "name": title[0],
            "crn": title[-3],
            "code": title[-2],
            "cr": credits_value,
            "ects": ects_credits,
            "eng": eng_credits,
            "bsc": basic_credits,
            "section": [
                {
                    "day": schedule[2].text,
                    "time": schedule[1].text,
                    "place": schedule[3].text,
                    "instructor": schedule[6].text,
                    "group": title[-1],
                } for schedule in sections
            ]
        }

        return course_information

    def get_catalog_details(self, url: str):
        """
        Read ECTS, Engineering and Basic Science credits off a catalog entry page.

        Always returns a 3-tuple. The previous version returned four values on a
        non-200 response, which raised ValueError at the call site and took the
        whole scrape down on any single 5xx.

        Returns (ects, engineering, basic_science); each is a number, or None when
        the page carries no attribute block at all - special topic courses have none.
        """
        response = None

        for attempt in range(2):
            try:
                response = self.session.get(url, timeout=15)
                break
            except requests.RequestException as error:
                print(f"Catalog request failed ({attempt + 1}/2) for {url}: {error}")

        if response is None or response.status_code != 200:
            print(f"Skipping catalog {url}: {response.status_code if response else 'no response'}")
            return None, None, None

        try:
            soup = BeautifulSoup(response.content, "html.parser")
            content = soup.find("td", attrs={"class": "ntdefault"})

            if content is None:
                return None, None, None

            full_text = content.get_text(separator="\n", strip=True)

            #  Everything we want sits under "Course Attributes:"; bounding the search
            #  keeps a number from a later section being read as a credit.
            if "Course Attributes:" not in full_text:
                return None, None, None

            attributes = full_text.split("Course Attributes:", 1)[1]

            for boundary in ("Restrictions:", "Corequisites:", "Prerequisites:"):
                attributes = attributes.split(boundary, 1)[0]

            #  Format on the page: "Lang. of Instruction: English, 6 ECTS (ENGINEERING:6 / BASIC:0)"
            ects_match = re.search(r"([\d.]+)\s*ECTS", attributes, re.IGNORECASE)

            #  Three cases live in this field and only two of them are the same thing:
            #    (ENGINEERING:6 / BASIC:0)  -> stated values
            #    (ENGINEERING: / BASIC:)    -> stated as carrying neither, i.e. zero.
            #                                  FASS courses come both ways, ECON 201 writes
            #                                  0 explicitly while SPS 101 leaves it blank.
            #    no parenthesis at all      -> the catalog says nothing, which is not zero.
            attribute_match = re.search(
                r"\(\s*ENGINEERING:([^/]*)/\s*BASIC:([^)]*)\)", attributes, re.IGNORECASE | re.DOTALL
            )

            def credit(raw):
                raw = raw.strip()

                return 0 if raw == "" else self.to_number(raw)

            return (
                self.to_number(ects_match.group(1)) if ects_match else None,
                credit(attribute_match.group(1)) if attribute_match else None,
                credit(attribute_match.group(2)) if attribute_match else None,
            )
        except Exception as error:
            print(f"Error parsing catalog {url}: {error}")
            return None, None, None

    def get_coursepage_details(self, course_code: str):
        """
        Second source for the ECTS breakdown: the course page behind
        sabanci_www.p_get_courses, which is a different system from the Banner catalog
        and sometimes carries a breakdown the catalog omits.

        Tries the undergraduate view first and the graduate view second, because the
        level a course is listed under is not always what its number suggests.

        Returns (ects, engineering, basic_science); each may be None.
        """
        match = re.match(r"^([A-Z]+)\s*(\w+)$", course_code.strip())

        if match is None:
            return None, None, None

        subject, number = match.group(1), match.group(2)

        for level in ("UG", "GR"):
            url = (f"https://suis.sabanciuniv.edu/prod/sabanci_www.p_get_courses"
                   f"?levl_code={level}&subj_code={subject}&crse_numb={number}&lang=eng")

            try:
                response = self.session.get(url, timeout=15)
            except requests.RequestException as error:
                print(f"Course page request failed for {course_code} [{level}]: {error}")

                continue

            if response.status_code != 200:
                continue

            try:
                soup = BeautifulSoup(response.content, "html.parser")

                for cell in soup.find_all("td"):
                    text = " ".join(cell.get_text(" ", strip=True).split())

                    if not re.search(r"\bECTS\b", text, re.IGNORECASE) or len(text) > 200:
                        continue

                    ects_match = re.search(r"([\d.]+)\s*ECTS", text, re.IGNORECASE)
                    attribute_match = re.search(
                        r"\(\s*ENGINEERING:([^/]*)/\s*BASIC:([^)]*)\)", text, re.IGNORECASE
                    )

                    def credit(raw):
                        raw = raw.strip()

                        return 0 if raw == "" else self.to_number(raw)

                    return (
                        self.to_number(ects_match.group(1)) if ects_match else None,
                        credit(attribute_match.group(1)) if attribute_match else None,
                        credit(attribute_match.group(2)) if attribute_match else None,
                    )
            except Exception as error:
                print(f"Error parsing course page for {course_code} [{level}]: {error}")

            time.sleep(0.1)

        return None, None, None

    def set_course_informations(self, course_informations: List[Dict]) -> List[Dict]:
        """
        Edit course information for json file.
        """
        data = []
        for course_info in course_informations:
            name = self.set_course_name(course_info["name"])
            code = self.set_course_code(course_info["code"])
            cr_val = course_info["cr"]
            crn = self.remove_blank_spaces(course_info["crn"])

            ects = course_info["ects"]
            eng = course_info["eng"]
            basic = course_info["bsc"]

            course_class = self.set_course_class(course_info["section"], course_info["code"], crn)

            course = next((item for item in data if item["code"] == code), None)
            if course is not None:
                #  "not course[...]" used to be the test here, which never fired: the old
                #  default was the string "0" and that is truthy. With None as the default
                #  the fill-if-missing rule finally works, and a real 0 is never overwritten.
                for key, value in (("cr", cr_val), ("ects", ects), ("eng", eng), ("bsc", basic)):
                    if course[key] is None and value is not None:
                        course[key] = value

                classes = next((item for item in course["classes"] if item["type"] == course_class["type"]), None)
                if classes is None:
                    course["classes"].append({
                        "type": course_class["type"],
                        "sections": [course_class["sections"]]
                    })
                else:
                    classes["sections"].append(course_class["sections"])

            else:
                data.append({
                    "name": name,
                    "code": code,
                    "cr": cr_val,
                    "ects": ects,
                    "eng": eng,
                    "bsc": basic,
                    "classes": [{
                        "type": course_class["type"],
                        "sections": [course_class["sections"]]
                    }]
                })

        return data

    def set_course_class(self, section: List[Dict], code: str, crn: str) -> Dict:
        """
        Edit course schedule for json file.
        """
        code = self.remove_blank_spaces(code)
        course_type = self.set_course_type(code)

        course_class = {
            "type": course_type,
            "sections": self.set_course_sections(section, crn)
        }

        return course_class

    def set_course_sections(self, section: List[Dict], crn: str) -> Dict:
        """
        Edit course schedule for json file.
        """
        schedules = []
        for schedule in section:
            day = self.set_course_day(schedule["day"])
            start, duration = self.set_course_time(schedule["time"])
            place = self.set_place(schedule["place"])
            group = self.remove_blank_spaces(section[0]["group"])
            schedules.append({
                "day": day,
                "place": place,
                "start": start,
                "duration": duration,
            })

        sections = {
            "crn": crn,
            "schedule": schedules,
            "group": group,
            "instructors": self.set_course_instructor(section[0]["instructor"]),
        }

        return sections

    @staticmethod
    def set_course_name(name: str) -> str:
        """
        Edit course name for json file.
        """
        if "Lab" in name and "Labor" not in name:
            name = name.replace("Lab", "")

        if "Recitation" in name:
            name = name.replace("Recitation", "")

        if "Discussion" in name:
            name = name.replace("Discussion", "")

        if name[-1] == " " or name[-1] == ",":
            name = name[:-1]

        if name[0] == " ":
            name = name[1:]

        return name

    @staticmethod
    def set_course_code(code: str) -> str:
        """
        Edit course code for json file.
        """
        if code[-1] == " ":
            code = code[:-1]

        if code[0] == " ":
            code = code[1:]

        if code[-1].isalpha():
            code = code[:-1]

        return code

    @staticmethod
    def remove_blank_spaces(text: str) -> str:
        """
        Edit course crn for json file.
        """
        if text[-1] == " ":
            text = text[:-1]

        if text[0] == " ":
            text = text[1:]

        return text

    @staticmethod
    def set_course_type(code: str) -> str:
        if code[-1] == "L":
            return "L"
        elif code[-1] == "D":
            return "D"
        elif code[-1] == "R":
            return "R"
        elif code[-1] == "N":
            return "N"
        elif code[-1] == "S":
            return "S"
        elif code[-1] == "E":
            return "E"
        else:
            return ""

    @staticmethod
    def set_course_day(day: str) -> int:
        """
        Edit course day for json file.
        """
        day_list = ["M", "T", "W", "R", "F", "S", "U"]
        try:
            return day_list.index(day)
        except ValueError:
            return 5

    
    @staticmethod
    def set_course_time(time: str) -> (int, int):
        """
        Edit course time for json file.
        """
        time = time.split(" - ")
        start_list = ['8:40 am', '9:40 am', '10:40 am', '11:40 am', '12:40 pm', '1:40 pm', '2:40 pm', '3:40 pm',
                      '4:40 pm', '5:40 pm', '6:40 pm', '8:00 am', '9:00 am', '10:00 am', '11:00 am', '12:00 pm',
                      '1:00 pm', '2:00 pm', '3:00 pm', '4:00 pm', '5:00 pm', '6:00 pm', '9:30 am', '10:30 am',
                      '11:30 am', '12:30 pm', '1:30 pm', '2:30 pm', '3:30 pm', '4:30 pm', '5:30 pm', '6:30 pm',
                      '7:30 pm']
        end_list = ['9:30 am', '10:30 am', '11:30 am', '12:30 pm', '1:30 pm', '2:30 pm', '3:30 pm', '4:30 pm',
                    '5:30 pm', '6:30 pm', '7:30 pm', '9:00 am', '10:00 am', '11:00 am', '12:00 pm', '1:00 pm',
                    '2:00 pm', '3:00 pm', '4:00 pm', '5:00 pm', '6:00 pm', '7:00 pm', '10:15 am', '11:15 am',
                    '12:15 pm', '1:15 pm', '2:15 pm', '3:15 pm', '4:15 pm', '5:15 pm', '6:15 pm', '7:15 pm',
                    '8.15 pm']

        try:
            start = start_list.index(time[0]) % 11
            end = end_list.index(time[1]) % 11
            duration = end - start + 1 if end >= start else -1

        except ValueError:
            start = -1
            duration = -1

        return start, duration

    def set_course_instructor(self, instructor: str) -> int:
        """
        Edit course instructor for json file.
        """
        instructor = " ".join(instructor.split())

        if instructor not in self.instructors:
            self.instructors.append(instructor)

        return self.instructors.index(instructor)

    def set_place(self, place: str) -> int:
        """
        Edit course place for json file.
        """
        place = place.replace("Fac.of Arts and Social Sci.", "FASS")
        place = place.replace("Sabancı Business School", "FMAN")
        place = place.replace("Fac. of Engin. and Nat. Sci.", "FENS")
        place = place.replace("School of Languages Building", "SL")
        place = place.replace("University Center", "UC")

        if place not in self.places:
            self.places.append(place)

        return self.places.index(place)

    @staticmethod
    def write_json_file(courses: List[Dict], instructors: List[str], places: List[str]):
        """
        Write json file.
        """
        #  Applied here, at the very end, so the two sources upstream keep working with a
        #  real "not stated" and the fallback is never mistaken for a value. Anything still
        #  missing after both the Banner catalog and the course page means the university
        #  publishes no engineering / basic science credit for that course, which in
        #  practice is zero - those credits only count toward undergraduate accreditation.
        #  ECTS is deliberately left alone: a zero ECTS would be wrong, not merely unknown.
        for course in courses:
            for key in ("eng", "bsc"):
                if course.get(key) is None:
                    course[key] = 0

        data = {"courses": courses,
                "instructors": instructors,
                "places": places}
        with open("data.min.json", "w", encoding='utf-8') as file:
            json.dump(data, file, ensure_ascii=False)


if __name__ == '__main__':
    term = int(sys.argv[1])
    scraper = SUcheduleCourseScraper(term=term)
    scraper.run()
