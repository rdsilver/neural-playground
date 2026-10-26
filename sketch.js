var neuronList = {};
var actionPotentialList = {};
var state = 'neuronPlacement';
var selectedNeuron = false;

var sketchOptions = {
  cellSize : 30,
  actionPotentialDivisor: 5,
  bgColor : 50,
  gridColor : 75,
  controlPanelSize: 100,
  canvasId: 'defaultCanvas0'
};

function setup() {
  createCanvas(window.innerWidth, window.innerHeight - sketchOptions.controlPanelSize);
  background(sketchOptions.bgColor);
  drawGraphLines();
}

function drawGraphLines() {
  var cols = _.ceil(width/sketchOptions.cellSize);
  var rows = _.ceil(height/sketchOptions.cellSize);

  stroke(sketchOptions.gridColor);
  _.times(cols, c => {
    c = c*sketchOptions.cellSize;
    line(c, 0, c, height);
  });

  _.times(rows, r => {
    r = r*sketchOptions.cellSize;
    line(0, r, width, r);
  });
}

// For non p5.js users, this methods gets called over and over again
function draw() {
  switch(state) {
    case 'live':
      clearScreen(false);
      Neuron.displayAllConnections();
      ActionPotential.displayAllActionPotentials();
      Neuron.displayAllNeurons();
      Neuron.allNeuronSpecificRoutines();
      break;
    default:
      clearScreen();
      mouseHover();
      ActionPotential.displayAllActionPotentials();
      Neuron.displayAllNeurons();
      Neuron.displayAllConnections();
  }
}


// Was using default param but not enough browser support
function clearScreen(keepGrid) {
  keepGrid = keepGrid === undefined;

  fill(sketchOptions.bgColor);
  noStroke();
  rect(0, 0, width, height);

  if (keepGrid) {
    drawGraphLines();
  }
}

function mouseClicked(event) {
  if (event.target.id !== sketchOptions.canvasId) {
    return;
  }

  var x = mouseX - (mouseX % sketchOptions.cellSize);
  var y = mouseY - (mouseY % sketchOptions.cellSize);

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

function mouseHover() {
  if (mouseY < 0) {
    return;
  }

  var x = mouseX - (mouseX % sketchOptions.cellSize);
  var y = mouseY - (mouseY % sketchOptions.cellSize);

  // Add grey hover state over cells that don't have a neuron
  if (!neuronList[`${x} ${y}`] && state === 'neuronPlacement') {
    fill(sketchOptions.gridColor);
    rect(x, y, sketchOptions.cellSize, sketchOptions.cellSize);
  }

  if (selectedNeuron) {
    var half = sketchOptions.cellSize/2;
    line(selectedNeuron.x + half, selectedNeuron.y + half, x+half, y+half);
  }
}

// Create neuron on spot if none exists, otherwise delete neuron at that spot
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
  resizeCanvas(window.innerWidth, window.innerHeight - sketchOptions.controlPanelSize);
  clearScreen();
}
