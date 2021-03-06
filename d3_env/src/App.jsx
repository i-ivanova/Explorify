import './App.css';
import  D3BarChart, { sortByName, sortByStream, sortByPopularity } from "./D3BarChart";
import CalendarHeatmap from "./CalendarHeatmap";
import D3Timeline from "./D3Timeline";
import logo from "./logo/logo1.png"
import 'bootstrap/dist/css/bootstrap.min.css';
import React, { useRef, useState } from "react";
import { Navbar, Container, Form, Nav, Row, Col, Card, InputGroup, Button } from "react-bootstrap";
import { BsQuestionCircle } from 'react-icons/bs';
import { Edgemap } from './edgemap/Edgemap';

const options = [
    { value: 'listening-history', label: 'Listening History' },
    { value: 'popularity', label: 'Popularity' },
    { value: 'alphabetical', label: 'Alphabetical' },
];

const sortAlpha = () => sortByName();
const sortStream = () => sortByStream();
const sortPopularity = () => sortByPopularity();

function App() {
    // IDs of artists to include in the edgemap
    const [edgemapArtists, setEdgemapArtists] = useState(undefined);

    let fullData = require("./data/Jonatan_data/processed_filtered_dataset.json");

    const topArtistsData = require("./data/Jonatan_data/top_artists.json");
    const streamingData = new Map(Object.entries(fullData));
    const timelineData = require("./data/Jonatan_data/timeline_data.json");

    return (
        <>
            {/*<Navbar bg="dark" variant="dark">
                <Nav className="container-fluid">
                    <Navbar.Brand class>
                        <img alt="" src={logo}
                             width="100%"
                             height="70"
                             className="d-inline-block align-top"
                             style={{marginLeft: "40px"}}
                        />
                    </Navbar.Brand>
                    <Navbar.Toggle />
                    <Navbar.Collapse className="justify-content-end">
                        <Form.Group controlId="formFileSm" className="ms-auto">
                            <Form.Control type="file" size="sm" />
                        </Form.Group>
                    </Navbar.Collapse>
                </Nav>
            </Navbar>*/}
            <Container fluid className="custom-container">
                <Row md={12} className={"row-col-pad"}>
                    <Col md={9} s={6}>
                        <Row md={9} className={"row-col-pad"}>
                            <Card className={"display-card"}>
                                <Edgemap artistIDs={edgemapArtists}/>
                            </Card>
                        </Row>
                        <Row className={"row-col-pad"}>
                            <Card className={"display-card"}>
                                <Card.Header className={"card-header-dark headingOne"}>
                                    <h4>
                                        Daily Listening Pattern
                                        <BsQuestionCircle/>
                                    </h4>
                                </Card.Header>
                                <CalendarHeatmap
                                    streamingData = { streamingData }
                                    topArtistsData = { topArtistsData }
                                    timelineData = { timelineData }
                                    setEdgemapArtists = { setEdgemapArtists }
                                />
                            </Card>
                        </Row>
                    </Col>
                    <Col md={3} s={6} className={"row-col-pad"}>
                        <Card className={"display-card"}>
                            <Card.Header className={"card-header-dark"}>
                                <h4>
                                    Top 20 Artists
                                    <BsQuestionCircle/>
                                </h4>
                            </Card.Header>
                            <br/>
                            <Card.Header className={"card-header-dark"}>
                                <h5 style={{paddingBottom: "10px"}}>Sorting Criteria</h5>
                                <div className={"button-span"}>
                                    <Button variant="info" style={{width: "30%"}} onClick={sortStream}>
                                        Streaming Time
                                    </Button>
                                    {' '}
                                    <Button variant="info" style={{width: "30%"}} onClick={sortPopularity}>
                                        Artist Popularity
                                    </Button>
                                    {' '}
                                    <Button variant="info" style={{width: "30%"}} onClick={sortAlpha}>
                                        Alphabetic
                                    </Button>
                                </div>
                            </Card.Header>
                            <br/>
                            <D3BarChart
                                topArtistsData = { topArtistsData }
                            />
                        </Card>
                    </Col>
                </Row>

                <Row md={12} className={"row-pad"}>
                    <Card className={"display-card headingOne"}>
                        <Card.Header className={"card-header-dark"}>
                            <h4>
                                Detailed Listening History per Day
                                <BsQuestionCircle/>
                            </h4>
                        </Card.Header>
                        <D3Timeline
                            data = { timelineData }
                        />
                    </Card>
                </Row>

            </Container>
        </>

    );
}

export default App;