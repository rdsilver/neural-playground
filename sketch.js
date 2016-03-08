'use strict';

var cellSize = 30;
var neuronList = {};
var actionPotentialList = {};
var state = 'neuronPlacement';
var neuronType = 'normal'
var selectedNeuron = false;
var bgColor = 50;
var gridColor = 75;

function setup() {
  createCanvas(window.innerWidth, window.innerHeight-100);
  background(bgColor);
  drawGraphLines();
}

function drawGraphLines() {
  var cols = _.floor(width/cellSize);
  var rows = _.floor(height/cellSize);

  stroke(gridColor);
  _.times(cols, c => {
    c = c*cellSize;
    line(c, 0, c, height);
  });

  _.times(rows, r => {
    r = r*cellSize;
    line(0, r, width, r);
  });
}

function draw() {
  switch(state) {
    case 'live':
      clearGrid(false);
      Neuron.displayAllConnections();
      ActionPotential.displayAllActionPotentials();
      Neuron.displayAllNeurons();
      Neuron.allNeuronSpecificRoutines();
      break;
    default:
      ActionPotential.displayAllActionPotentials();
      Neuron.displayAllNeurons();
      Neuron.displayAllConnections();
  }
}

function clearGrid(keepGrid) {
  fill(bgColor);
  noStroke();
  rect(0, 0, width, height);

  if (keepGrid)
    drawGraphLines();
}

function mouseClicked() {
  // If they don't click on the grid just exit
  if (mouseY < 0)
    return;

  var x = mouseX - (mouseX % cellSize);
  var y = mouseY - (mouseY % cellSize);

  switch(state) {
    case 'neuronPlacement':
      placeNeurons(x, y);
      break;
    case 'connectionPlacement':
      connectNeurons(x, y);
      break;
    case 'live':
      live(x, y);
      break;
  }
}

// Create neuron on spot if none exists, else delete
function placeNeurons(x, y) {
  if (!neuronList[`${x} ${y}`]) {
    Neuron.createNeuron(x, y);
  } else {
    Neuron.deleteNeuron(x, y);
  }
}

// Set selected, else check if selected is connecting to another neuron to add connections
function connectNeurons(x, y) {
  if (!selectedNeuron) {
    Neuron.selectNeuron(x, y);
  } else if (neuronList[`${x} ${y}`]) {
    Neuron.addConnection(x, y);
  } else {
    Neuron.unSelectNeuron();
  }
}

function live(x, y) {
  if (neuronList[`${x} ${y}`]) {
    neuronList[`${x} ${y}`].addCharge(1);
  }
}


function windowResized() {
  resizeCanvas(window.innerWidth, window.innerHeight - 100);
  clearGrid(true);
}