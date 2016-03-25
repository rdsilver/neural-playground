#Neural Playground
Place, connect, and play around with your own neural network composed of different types of neurons

View the project here http://rdsilver.github.io/neural-playground/
(Only tested in Chrome)
(Once this is a RoR app I will compile with Babel so everyone can use)

##Instructions:

Click on a cell when in "Place/Delete neuron mode" to place a neuron there of your choosing. To delete a neuron at a cell, click on it while in "Place/Delete neuron mode" To change neuron type choose an option from the dropdown menu

To add connections between neurons click anywhere inside the "Place/Delete connection" to switch to that mode. First select a neuron (will turn gold) then select the neuron you want it to be connected to. To delete a connection do the same thing but where a connection already exists. Connections can either be one way or two way connections. (I need to come up with a way to tell these apart by looking at the connection)

Click anywhere in the "live" panel to switch to live mode. Click on a cell to add one charge, once a neuron reaches it's activation level it will send out an action potential to all it's outbound neighbors.

Timer Neurons ignore inbound action potentials and just continue do activate every X seconds.

This is a WIP and new features will be added along side a better GUI. You can track what is being worked on in the github ISSUES.


### Adding your own neuron/features
If you add a neuron/feature, please make sure all tests pass and to add relevant testing methods
http://rdsilver.github.io/neural-playground/jasmine/SpecRunner.html?
