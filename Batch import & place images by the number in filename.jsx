#target "InDesign"
#targetengine "session"

var customization = {
  allowMissingNumbers: false, // Permanently ignores files that don't have numbers in them
  inputFormats: 'tiff?|gif|jpe?g|bmp|eps|svg|png|ai|psd|pdf', // Defaults: 'tiff?|gif|jpe?g|bmp|eps|svg|png|ai|psd|pdf'
  // Just a couple alternative regexes
  // folderTemplateRegex: "\\((.*?)\\)", // https://regex101.com/r/MgiHaQ/3 (since these are stored as strings in this script, you need to double up the backslashes)
  // folderTemplateRegex: "@(.*?$)",     // https://regex101.com/r/MgiHaQ/2 
  templateRegex: "@.*?$",                // https://regex101.com/r/MgiHaQ/1 
  templateDivisionRegex: "#.*?$", // This is exactly the same as above, but just using the "#" character
  filePageNumberRegex: "^\\d*", // https://regex101.com/r/WqlhXS/1 (since these are strings, we need to double up the backslashes)
  showPage: true, // Whether or not to show each page when placing files
  showPageZoomOut: 0, // If "showPage" is true, zoom out this amount of times. 0 = fit page to window
  showPageDelay: 0, // Milliseconds. Additional delay if you reaaaaaaally want to linger on the page after the file has been placed
  pdfCrop: ['cropTrim', 'cropBleed', 'cropPDF', 'cropMedia'], // PDF crop fallback order
  pdfTransparentBackground: true,
};

// Try & catch just in case there are no documents open.
try {
  
  var doc = app.activeDocument;
  var docPref = doc.documentPreferences;
  var viewPref = doc.viewPreferences;
  
  var settings = {
    sourceFolder: null,
    files: null,
    layers: [],
    custom: customization,
    initPagesLength: docPref.pagesPerDocument,
    pagesLength: docPref.pagesPerDocument,
    errors: [
      { errors: [], type: 'noPageNumber', label: '# Missing page numbers: \n> (Make sure all files have page numbers or turn on the setting "allowMissingNumbers")' },
      { errors: [], type: 'missingMaster', label: '# Missing master pages: \n> (You have folders with these template names, but no matching master pages in the document)' },
      { errors: [], type: 'noMasterGraphicFrame', label: '# Template (master page) is missing a graphic frame: \n> (You need at least one graphic frame per template page. If you only use 1 page of the master spread, delete the other page)' },
      { errors: [], type: 'missingLayer', label: '# Missing division layer: \n> (You have folders with these division names, but no matching layers in the document)' },
    ],
    missingMasterNames: [],
    missingDivisionNames: [],
    masterSpreads: [],
    layers: [],
    dialog: {},
    duration: '',
  };
  
} catch (e) {}

// ************************
// 	Main body
// ************************
function init() {
  
  // If file has been saved, start selectDialog from the current document root folder.
  var inputPath = ""; try { inputPath = doc.filePath; } catch (e) {}
  
  // Browse for source folder
  var folder = Folder.selectDialog("Choose input folder...", inputPath);
  
  if ( folder != null ) {
    
    settings.sourceFolder = folder;
    settings.files = operations.getFiles( folder );
    
    operations.errors.test();
    
    docPref.pagesPerDocument = settings.pagesLength;
      
    if ( operations.errors.length() ) {
      
      operations.dialog.error( operations.errors.print() );
      
      operations.make.masterTemplates();
      operations.make.divisionLayers();
      
      if ( !settings.dialog.allowMissingNumbers ) {
        docPref.pagesPerDocument = settings.initPagesLength;
      }
      else {
        
        // If missingNumbers are allowed and no other errirs exist...
        var justNoPagesNumber = true;
        operations.each( settings.errors, function( error ) {
          if ( (error.type !== "noPageNumber") && (error.errors.length > 0) ) {
            justNoPagesNumber = false;
            return false;
          }
        });
        if ( justNoPagesNumber ) operations.place.start();
        
      }
      
    }
    else {
      operations.place.start();
    }
    
  }
} // init();


// ************************
// 	Stuff happens here
// ************************

var operations = {
  
  make: {
    item: function( file ) {
      
      var item = null;
      
      var pageNumber = operations.regex.getPageNumber( file ).page;
      if ( pageNumber ) {
        item = {};
        var templateName        = operations.regex.getTemplateName( file );
        item.pageNumber         = pageNumber,
        item.page               = operations.getPage( item.pageNumber );
        item.file               = file;
        item.name               = file.displayName;
        item.isOdd              = operations.isOdd( file.page );
        item.parent             = file.parent.displayName;
        item.templateName       = templateName.template;
        item.templateDivision   = templateName.division;
        item.template           = operations.getMasterByName( item );
        item.layer              = operations.add.layer( item );
        item.graphicFrameLayers = [];
        item.graphicFrames      = operations.make.graphicFrames( item ); // null if !item.layer && !item.page
      }
      
      return item; // No need for item if page number doesn't exist
    },
    
    graphicFrames: function( item ) {
    
      if ( item.layer && item.page ) {
        if ( !item.template ) {
          return [item.page.rectangles.add( item.layer, {
            fillColor: doc.swatches.itemByName("None"), 
            strokeColor: doc.swatches.itemByName("None"), 
            geometricBounds: item.page.bounds
          })];
        }
        else {
          
          var pageItems = [];
          var duplicatePageItems = [];
          
          
          // Basically, if item doesn't have a division, all graphic frame in the template page are used.
          operations.each( item.template.allPageItems, function( pageItem ) {
            if ( item.templateDivision ) {
              if ( pageItem.itemLayer.name === item.templateDivision ) {
                pageItems.push( pageItem );
              }
            }
            else {
              pageItems.push( pageItem );
            }
          });
          
          operations.each( pageItems, function( graphicFrame ) {
            
            var layerLocked = graphicFrame.itemLayer.locked;
            graphicFrame.itemLayer.locked = false;
            
            var masterSingleSided = item.template.side == PageSideOptions.SINGLE_SIDED;
            var duplicatePageItem = graphicFrame.duplicate( item.page );
            
              var frame = {
                bounds: graphicFrame.geometricBounds,
                top   : graphicFrame.geometricBounds[0],
                left  : graphicFrame.geometricBounds[1],
                bottom: graphicFrame.geometricBounds[2],
                right : graphicFrame.geometricBounds[3],
              };
              var page = {
                bounds: item.page.bounds,
                top   : item.page.bounds[0],
                left  : item.page.bounds[1],
                bottom: item.page.bounds[2],
                right : item.page.bounds[3],
              };
            if ( masterSingleSided ) {
              
              duplicatePageItem.geometricBounds = [
                frame.top + page.top,
                frame.left + page.left,
                frame.bottom + page.top,
                frame.right + page.left,
              ];
              
            }
            else {
              
              var singePageSpread = item.page.parent.pages.length < 2;
              duplicatePageItem.geometricBounds = [
                frame.top + page.top,
                frame.left - ( singePageSpread ? frame.left : 0 ),
                frame.bottom + page.top,
                frame.right - ( singePageSpread ? frame.left : 0 ),
              ];
            }
            
            duplicatePageItems.push( duplicatePageItem );
            item.graphicFrameLayers.push( duplicatePageItem.itemLayer ); // Save the original layer for template division purposes
            duplicatePageItem.itemLayer = item.layer;
            
            graphicFrame.itemLayer.locked = layerLocked;
            
          });
          
          pageItems = null;
          return duplicatePageItems;
          
        }
      }
      else { return null; }
  
    },
    
    masterTemplates: function() {
      if ( settings.dialog.createMasters ) {
        operations.each( settings.missingMasterNames, function( masterName  ) {
              
          var nameSplit = masterName.split(/-(.+)/);
          if ( nameSplit.length > 1 ) {
            try { 
              doc.masterSpreads.add({
                namePrefix: nameSplit[0],
                baseName:   nameSplit[1].replace(/^-/,''),
              });
            } catch(e) {}
          }
          
        });
      }
    },
    
    divisionLayers: function() {
      if ( settings.dialog.createDivisions ) {
        
        operations.each( settings.missingDivisionNames, function( divisionName ) {
          
          var layers = app.activeDocument.layers;
          var layer = layers.add({ name: divisionName });
          
        });
        
      }
    },
  },
  
  each: function( array, callback ) {
    var result;
    if ( array ) {
      for ( var i=0; i < array.length; i++) {
        var comeback = callback( array[i], i  );
        if ( comeback === false ) {
          result = 'error';
          break;
        }
      }
    } else { result = 'invalid input' }
    return result;
  },
  
  eachLength: function( lengthyLength, callback ) {
    var result;
    if ( lengthyLength ) {
      for ( var i=0; i < lengthyLength; i++) {
        var comeback = callback( i  );
        if ( comeback === false ) {
          result = 'error';
          break;
        }
      }
    } else { result = 'invalid input' }
    return result;
  },
  
  getMasterByName: function( item ) {
    
    var master = null;
    if ( item.templateName ) {
      
      operations.each( doc.masterSpreads, function( loopMaster ) {
        if ( loopMaster.name === item.templateName ) {
          if ( loopMaster.pages.length > 1 ) {
            operations.each( loopMaster.pages, function( page ) {
              try {
                if ( item.page.side === page.side ) {
                  master = page;
                  return false;
                }
              } catch(e){
                master = loopMaster.pages[0];
                }
              }); 
            }
          else {
            master = loopMaster.pages[0];
          }
          return false;
        }
      });
    }
    
    if ( master ) {
      if ( !operations.inArray( settings.masterSpreads, master.parent ) ) {
        settings.masterSpreads.push( master.parent );
      }
    }
    
    return master;
  },
  
  getPage: function( pageNumber ) {
    
    var result = null;
    
    try {
      var test = doc.pages.itemByName( pageNumber ).name;
      result = doc.pages.itemByName( pageNumber );
    } catch( e ) { }
    
    return result;
  },
  
  errors: {
    test: function() {
      
      // Adds more pages if numbers surpass the original number of pages. Removed later if any errors are found. Required for: getMasterByName()
      operations.each( settings.files, function( file ) {
        operations.regex.getPageNumber( file ).page;
      });
      docPref.pagesPerDocument = settings.pagesLength; 
      
      operations.each( settings.files, function( file ) {
        
        var pageNumber = operations.regex.getPageNumber( file ).page;
        if ( !settings.custom.allowMissingNumbers && !pageNumber ) operations.errors.push( "noPageNumber", file.displayName );
        
        if ( pageNumber ) {
          
          var template = operations.regex.getTemplateName( file );
          var templateName = template.template;
          var divisionName = template.division;
          
          var layerName = templateName;
          var parentIsSource = file.parent.displayName === settings.sourceFolder.displayName;
          if ( !layerName && parentIsSource ) layerName = file.parent.displayName;
          if ( layerName ) operations.remove.layer( layerName );
          
          var masterPage = operations.getMasterByName({ 
            page: operations.getPage( pageNumber ), 
            templateName: templateName,
          });
          
          if ( masterPage === null && templateName ) {
            var masterPrefixDash = templateName.match(/\-/);
            var suffix = masterPrefixDash ? '' : ' (Invalid name: template name needs to contain a dash after the prefix: "A-master" and the prefix can be 4 characters long.)'
            var pushedMissingMaster = operations.errors.push( "missingMaster", templateName + suffix );
            if ( pushedMissingMaster ) settings.missingMasterNames.push( templateName );
          }
          
          if ( divisionName ) {
            if ( !operations.exists.layer( divisionName ) ) {
              var pushedMissingLayer = operations.errors.push( "missingLayer", divisionName );
              if ( pushedMissingLayer ) settings.missingDivisionNames.push( divisionName );
            }
          }
          
        }
        
      });
      
      operations.each( settings.masterSpreads, function( masterSpread ) {
        operations.each( masterSpread.pages, function( masterPage ) {
          
          var masterPageItems = masterPage.allPageItems;
          if ( masterPageItems.length < 1 ) {
            operations.errors.push( "noMasterGraphicFrame", masterPage.parent.name + '('+ operations.print.pageSide( masterPage.side ) +')' );
          }
          
        });
      });
      
    },
    length: function() {
      
      var errorsLength = 0;
      operations.each( settings.errors, function( obj ) {
        errorsLength = errorsLength + obj.errors.length;
      });
      return errorsLength;
      
    },
    push: function( type, errorMsg ) {
      
      var pushed = false;
      operations.each( settings.errors, function( obj ) {
        if ( obj.type === type ) {
          
          var duplicateMessage = operations.inArray( obj.errors, errorMsg );
          if ( !duplicateMessage ) { 
            obj.errors.push( errorMsg );
            pushed = true;
          }
          
          return false;
        }
      });
      return pushed;
      
    },
    get: function( label ) {
      
      var result;
      operations.each( settings.errors, function( error ) {
        if ( error.type === label ) {
          result = error;
          return false;
        }
      });
      return result;
      
    },
    print: function() {
            
      var string = 'These errors have to be resolved before you can continue!!';
      operations.each( settings.errors, function( obj, index ) {
        if ( obj.errors.length > 0 ) string += '\n\n'+ obj.label + '\n\n';
        operations.each( obj.errors, function( error ) {
          string +=  '* ' + error + '\n';
        });
      });
      return string;
      
    }
  },
  
  inArray: function( array, value ) {
    var result = false;
    operations.each( array, function( loopValue ) {
      if ( loopValue === value ) { 
        result = true;
        return false; 
      }
    });
    return result;
  },
  
  regex: {
    getPageNumber: function( file ) {
      
      var result = {
        filename: file.displayName,
        page: null, 
      };
      var filename = file.displayName;
      var regex = new RegExp( (settings.custom.filePageNumberRegex || '^\\d*'));
      filename = filename.match( regex );
      if ( filename ) {
        result.filename = filename[0].replace(regex, '');
        result.page = filename[0].replace(/^0+/, '');
        // Updates pagesLength in name only. The pages will actually be created after the first dry run.
        var pageNumber = parseInt( result.page );
        if ( pageNumber > settings.pagesLength ) settings.pagesLength = pageNumber;
      }
      return result;
      
    },
    getTemplateName: function( file ) {
      
      var foundDivision = false;
      var foundTemplate = regexInception( file );
      
      return {
        template: foundTemplate,
        division: foundDivision,
      };
      
      function regexInception( file ) {
        if ( file.absoluteURI !== settings.sourceFolder.absoluteURI ) { // Don't look past the source path
          
          var fileName = file.displayName.substr(0, file.displayName.lastIndexOf('.'));
          var parentFolderName = file.parent.displayName;
          
          var divisionRegex = new RegExp( settings.custom.templateDivisionRegex || "#.*?$" );
          var divisionName = fileName.match( divisionRegex  ) || parentFolderName.match( divisionRegex  );
          
          var templateRegex = new RegExp( settings.custom.templateRegex || "@.*?$" );
          var templateName = fileName.match( templateRegex  ) || parentFolderName.match( templateRegex  );
          
          if ( divisionName ) {
            foundDivision = divisionName[ divisionName.length-1 ];
            templateName = templateName ? templateName[ templateName.length-1 ] : regexInception( file.parent );
          }
          else if ( templateName ) {
            templateName = templateName[ templateName.length-1 ];
          }
          else {
            templateName = regexInception( file.parent ); // No template: traverse upwards to look for one
          }
          return templateName;
          
        } else { return null; }
      }
      
    },
  },
  
  add: {
    layer: function( item, removeExisting ) {
      
      var layerName = item.templateName;
      
      // Source folder name is used as the default layer name if template is not set
      // Note: parent folder name can also point to a template
      var parentIsSource = item.file.parent.displayName === settings.sourceFolder.displayName;
      if ( !layerName && parentIsSource ) {
        layerName = item.file.parent.displayName;
      }
      
      if ( layerName ) {
        
        if ( removeExisting ) operations.remove.layer( layerName );
        
        var layers = app.activeDocument.layers;
        var exists = operations.exists.layer( layerName );
        if ( !exists ) {
          var newLayer = layers.add({ name: layerName });
          settings.layers.push( newLayer );
        }
        
        return layers.itemByName( layerName );
        
      }
      
    }
  },
  remove: {
    layer: function( layerName ) {
      
      var layers = app.activeDocument.layers;
      var exists = operations.exists.layer( layerName );
      if ( exists ) {
        layers.itemByName( layerName ).remove();
      }
      
    }
  },
  exists: {
    layer: function( inputName ) {
      
      var exists = false;
      var layers = app.activeDocument.layers;
      operations.each( layers, function( loopLayer ) {
        if ( inputName === loopLayer.name ) {
          exists = true;
        }
      });
      return exists;
      
    }
  },
  
  dialog: {
    error: function( errorsString ) {

      /*
      Code for Import https://scriptui.joonas.me — (Triple click to select): 
      {"activeId":7,"items":{"item-0":{"id":0,"type":"Dialog","parentId":false,"style":{"enabled":true,"varName":null,"windowType":"Dialog","creationProps":{"su1PanelCoordinates":false,"maximizeButton":false,"minimizeButton":false,"independent":false,"closeButton":true,"borderless":false,"resizeable":false},"text":"Errors:","preferredSize":[0,0],"margins":16,"orientation":"column","spacing":10,"alignChildren":["center","top"]}},"item-1":{"id":1,"type":"EditText","parentId":0,"style":{"enabled":true,"varName":"errors","creationProps":{"noecho":false,"readonly":true,"multiline":true,"scrollable":true,"borderless":false,"enterKeySignalsOnChange":false},"softWrap":false,"text":"","justify":"left","preferredSize":[800,500],"alignment":null,"helpTip":null}},"item-2":{"id":2,"type":"Button","parentId":0,"style":{"enabled":true,"varName":"cancel","text":"Close","justify":"center","preferredSize":[0,0],"alignment":null,"helpTip":null}},"item-5":{"id":5,"type":"Checkbox","parentId":0,"style":{"enabled":true,"varName":"allowMissingNumbers","text":"Ignore files with missing page number this time... (?)","preferredSize":[0,0],"alignment":null,"helpTip":"Enabled if no other errors are present. You can also enable this 'allowMissingNumbers' setting in the script file to make it permanent.","checked":false}},"item-6":{"id":6,"type":"Checkbox","parentId":0,"style":{"enabled":true,"varName":"missingMasters","text":"Create missing master page templates on close (?)","preferredSize":[0,0],"alignment":null,"helpTip":"Either way the script will stop here! You still need to add the placeholder graphic frames yourself.","checked":true}},"item-7":{"id":7,"type":"Checkbox","parentId":0,"style":{"enabled":true,"varName":"missingDivisions","text":"Create missing division layers on close (?)","preferredSize":[0,0],"alignment":null,"helpTip":"Either way the script will stop here! You still have to assign graphic frames their own division layers for this to affect anything.","checked":true}}},"order":[0,1,5,6,7,2],"settings":{"importJSON":true,"indentSize":false,"cepExport":false,"includeCSSJS":true,"showDialog":false,"functionWrapper":false,"afterEffectsDockable":false,"itemReferenceList":"None"}}
      */ 

      // DIALOG
      // ======
      var dialog = new Window("dialog"); 
          dialog.text = "Errors:"; 
          dialog.orientation = "column"; 
          dialog.alignChildren = ["center","top"]; 
          dialog.spacing = 10; 
          dialog.margins = 16; 

      var errors = dialog.add('edittext {properties: {name: "errors", readonly: true, multiline: true, scrollable: true}}'); 
          errors.preferredSize.width = 800; 
          errors.preferredSize.height = 500; 

      var allowMissingNumbers = dialog.add("checkbox", undefined, undefined, {name: "allowMissingNumbers"}); 
          allowMissingNumbers.helpTip = "Enabled if no other errors are present. You can also enable this 'allowMissingNumbers' setting in the script file to make it permanent."; 
          allowMissingNumbers.text = "Ignore files with missing page number this time... (?)"; 

      var missingMasters = dialog.add("checkbox", undefined, undefined, {name: "missingMasters"}); 
          missingMasters.helpTip = "Either way the script will stop here! You still need to add the placeholder graphic frames yourself."; 
          missingMasters.text = "Create missing master page templates on close (?)"; 
          missingMasters.value = true; 

      var missingDivisions = dialog.add("checkbox", undefined, undefined, {name: "missingDivisions"}); 
          missingDivisions.helpTip = "Either way the script will stop here! You still have to assign graphic frames their own division layers for this to affect anything."; 
          missingDivisions.text = "Create missing division layers on close (?)"; 
          missingDivisions.value = true; 

      var cancel = dialog.add("button", undefined, undefined, {name: "cancel"}); 
          cancel.text = "Close"; 
      
      
      
      // CUSTOMIZATION: 
      errors.text = errorsString;
      
      var errors = {
        missingMaster: operations.errors.get('missingMaster').errors,
        noPageNumber: operations.errors.get('noPageNumber').errors,
        missingDivision: operations.errors.get('missingLayer').errors,
      };
      if ( errors.missingMaster.length   < 1 ) dialog.remove(missingMasters);
      if ( errors.noPageNumber.length    < 1 ) dialog.remove(allowMissingNumbers);
      if ( errors.missingDivision.length < 1 ) dialog.remove(missingDivisions);
      
      // If any other errors exist, disable checkbox
      operations.each( settings.errors, function( error ) {
        if ( (error.type !== "noPageNumber") && (error.errors.length > 0) ) {
          if ( dialog.findElement('allowMissingNumbers') ) allowMissingNumbers.enabled = false;
          return false;
        }
      });
      
      cancel.onClick = function() {
        done();
      }
      
      function done() {
        if ( dialog.findElement('allowMissingNumbers') ) settings.dialog.allowMissingNumbers = allowMissingNumbers.value;
        if ( dialog.findElement('missingMasters')      ) settings.dialog.createMasters       = missingMasters.value;
        if ( dialog.findElement('missingDivisions')    ) settings.dialog.createDivisions     = missingDivisions.value;
        dialog.close();
      }
      
      dialog.show();
      
      return dialog;

    }, 
    
    warning: function() {

      /*
      Code for Import https://scriptui.joonas.me — (Triple click to select): 
      {"activeId":11,"items":{"item-0":{"id":0,"type":"Dialog","parentId":false,"style":{"enabled":true,"varName":null,"windowType":"Dialog","creationProps":{"su1PanelCoordinates":false,"maximizeButton":false,"minimizeButton":false,"independent":false,"closeButton":true,"borderless":false,"resizeable":false},"text":"Batch import & place images by the number in filename.jsx","preferredSize":[0,0],"margins":16,"orientation":"column","spacing":10,"alignChildren":["fill","top"]}},"item-1":{"id":1,"type":"StaticText","parentId":2,"style":{"enabled":true,"varName":null,"creationProps":{"truncate":"none","multiline":false,"scrolling":false},"softWrap":false,"text":"Make sure to save the document before running the script. ","justify":"center","preferredSize":[0,0],"alignment":null,"helpTip":null}},"item-2":{"id":2,"type":"Panel","parentId":0,"style":{"enabled":true,"varName":null,"creationProps":{"borderStyle":"etched","su1PanelCoordinates":false},"text":"Warning","preferredSize":[0,0],"margins":29,"orientation":"column","spacing":10,"alignChildren":["center","top"],"alignment":null}},"item-3":{"id":3,"type":"Button","parentId":5,"style":{"enabled":true,"varName":"ok","text":"Continue: select input folder","justify":"center","preferredSize":[0,0],"alignment":null,"helpTip":null}},"item-4":{"id":4,"type":"Button","parentId":5,"style":{"enabled":true,"varName":"cancel","text":"Cancel","justify":"center","preferredSize":[0,0],"alignment":null,"helpTip":null}},"item-5":{"id":5,"type":"Group","parentId":2,"style":{"enabled":true,"varName":null,"preferredSize":[0,0],"margins":[16,0,0,0],"orientation":"row","spacing":10,"alignChildren":["left","center"],"alignment":null}},"item-6":{"id":6,"type":"Panel","parentId":0,"style":{"enabled":false,"varName":null,"creationProps":{"borderStyle":"etched","su1PanelCoordinates":false},"text":"Setup instructions","preferredSize":[0,0],"margins":29,"orientation":"column","spacing":10,"alignChildren":["fill","top"],"alignment":null}},"item-8":{"id":8,"type":"StaticText","parentId":25,"style":{"enabled":true,"varName":null,"creationProps":{"truncate":"none","multiline":false,"scrolling":false},"softWrap":false,"text":"2. Add template name to either the input folder, subfolder, or file (?)","justify":"left","preferredSize":[0,0],"alignment":null,"helpTip":"This is technically optional. If you don't use a template, the image will be centered in the document. \\n\\n The closest parent template is always used. \\n\\n You can change this template identifier regex in the script file."}},"item-10":{"id":10,"type":"StaticText","parentId":24,"style":{"enabled":true,"varName":null,"creationProps":{"truncate":"none","multiline":false,"scrolling":false},"softWrap":false,"text":"1. Make sure input folder items have page numbers in the front (?)","justify":"left","preferredSize":[0,0],"alignment":null,"helpTip":"You can place multiple multiple files on one page. Just make sure the templates don't overlap unnecessarily. \\n\\n You can change this number regex in the script file."}},"item-11":{"id":11,"type":"StaticText","parentId":39,"style":{"enabled":true,"varName":null,"creationProps":{"truncate":"none","multiline":false,"scrolling":false},"softWrap":false,"text":"4. Add graphic frame(s) to all template master pages","justify":"left","preferredSize":[0,0],"alignment":null,"helpTip":""}},"item-21":{"id":21,"type":"StaticText","parentId":2,"style":{"enabled":false,"varName":null,"creationProps":{"truncate":"none","multiline":false,"scrolling":false},"softWrap":false,"text":"All layers previously created by it will be removed (?) ","justify":"center","preferredSize":[0,0],"alignment":null,"helpTip":"When layers are removed their contents are removed too! \\n\\n The layer names are based on either the template name or the input folder name. \\n\\n So if you change any of those names after running the script, it won't be able to remove layers automatically anymore."}},"item-22":{"id":22,"type":"StaticText","parentId":28,"style":{"enabled":true,"varName":null,"creationProps":{"truncate":"none","multiline":false,"scrolling":false},"softWrap":false,"text":"3. Make new master pages that match the the template names","justify":"left","preferredSize":[0,0],"alignment":null,"helpTip":""}},"item-23":{"id":23,"type":"StaticText","parentId":32,"style":{"enabled":true,"varName":null,"creationProps":{"truncate":"none","multiline":false,"scrolling":false},"softWrap":false,"text":"input folder/01 my file.pdf\ninput folder/4 my file.pdf\ninput folder/21 another file.jpg","justify":"left","preferredSize":[0,0],"alignment":null,"helpTip":""}},"item-24":{"id":24,"type":"Group","parentId":6,"style":{"enabled":true,"varName":null,"preferredSize":[0,0],"margins":0,"orientation":"column","spacing":5,"alignChildren":["fill","center"],"alignment":null}},"item-25":{"id":25,"type":"Group","parentId":6,"style":{"enabled":true,"varName":null,"preferredSize":[0,0],"margins":0,"orientation":"column","spacing":5,"alignChildren":["fill","center"],"alignment":null}},"item-27":{"id":27,"type":"StaticText","parentId":34,"style":{"enabled":true,"varName":null,"creationProps":{"truncate":"none","multiline":false,"scrolling":false},"softWrap":false,"text":"input folder @-template-1/1 my file.pdf\ninput folder @-template-1/@-template-2/20 my file.pdf\ninput folder @-template-1/20 my file @-template-2.pdf","justify":"left","preferredSize":[0,0],"alignment":null,"helpTip":""}},"item-28":{"id":28,"type":"Group","parentId":6,"style":{"enabled":true,"varName":null,"preferredSize":[0,0],"margins":0,"orientation":"column","spacing":5,"alignChildren":["fill","center"],"alignment":null}},"item-30":{"id":30,"type":"StaticText","parentId":44,"style":{"enabled":true,"varName":null,"creationProps":{"truncate":"none","multiline":false,"scrolling":false},"softWrap":false,"text":"\\u2022 You can run the script once to let it make all the necessary master pages.\n\\u2022 You still have to do the next step manually...","justify":"left","preferredSize":[0,0],"alignment":null,"helpTip":""}},"item-31":{"id":31,"type":"StaticText","parentId":32,"style":{"enabled":true,"varName":null,"creationProps":{"truncate":"none","multiline":false,"scrolling":false},"softWrap":false,"text":"would end up in page 1\nwould end up in page 4\nwould end up in page 21","justify":"left","preferredSize":[0,0],"alignment":null,"helpTip":""}},"item-32":{"id":32,"type":"Group","parentId":38,"style":{"enabled":true,"varName":null,"preferredSize":[0,0],"margins":0,"orientation":"row","spacing":10,"alignChildren":["left","center"],"alignment":null}},"item-33":{"id":33,"type":"StaticText","parentId":34,"style":{"enabled":true,"varName":null,"creationProps":{"truncate":"none","multiline":false,"scrolling":false},"softWrap":false,"text":"uses master page \"@-template-1\"\nuses master page \"@-template-2\"\nuses master page \"@-template-2\"","justify":"left","preferredSize":[0,0],"alignment":null,"helpTip":""}},"item-34":{"id":34,"type":"Group","parentId":37,"style":{"enabled":true,"varName":null,"preferredSize":[0,0],"margins":0,"orientation":"row","spacing":10,"alignChildren":["left","center"],"alignment":null}},"item-35":{"id":35,"type":"Divider","parentId":34,"style":{"enabled":true,"varName":null}},"item-36":{"id":36,"type":"Divider","parentId":32,"style":{"enabled":true,"varName":null}},"item-37":{"id":37,"type":"Panel","parentId":43,"style":{"enabled":true,"varName":null,"creationProps":{"borderStyle":"etched","su1PanelCoordinates":false},"text":"","preferredSize":[0,0],"margins":10,"orientation":"column","spacing":10,"alignChildren":["left","top"],"alignment":null}},"item-38":{"id":38,"type":"Panel","parentId":42,"style":{"enabled":true,"varName":null,"creationProps":{"borderStyle":"etched","su1PanelCoordinates":false},"text":"","preferredSize":[0,0],"margins":10,"orientation":"column","spacing":10,"alignChildren":["left","top"],"alignment":null}},"item-39":{"id":39,"type":"Group","parentId":6,"style":{"enabled":true,"varName":null,"preferredSize":[0,0],"margins":0,"orientation":"column","spacing":5,"alignChildren":["fill","center"],"alignment":null}},"item-41":{"id":41,"type":"StaticText","parentId":45,"style":{"enabled":true,"varName":null,"creationProps":{"truncate":"none","multiline":false,"scrolling":false},"softWrap":false,"text":"\\u2022 By default the images will simply be positioned in the center of the graphic frame.\n\\u2022 These graphic frames define the position and optionally the size too. \n\\u2022 You can use 'Object > Fitting > Frame fitting options...' to make the images fit or fill inside the graphic frame.","justify":"left","preferredSize":[0,0],"alignment":null,"helpTip":""}},"item-42":{"id":42,"type":"Group","parentId":6,"style":{"enabled":true,"varName":null,"preferredSize":[0,0],"margins":[0,0,0,15],"orientation":"row","spacing":10,"alignChildren":["left","center"],"alignment":null}},"item-43":{"id":43,"type":"Group","parentId":6,"style":{"enabled":true,"varName":null,"preferredSize":[0,0],"margins":[0,0,0,15],"orientation":"row","spacing":10,"alignChildren":["left","center"],"alignment":null}},"item-44":{"id":44,"type":"Group","parentId":28,"style":{"enabled":true,"varName":null,"preferredSize":[0,0],"margins":[0,0,0,15],"orientation":"row","spacing":11,"alignChildren":["left","center"],"alignment":null}},"item-45":{"id":45,"type":"Group","parentId":39,"style":{"enabled":true,"varName":null,"preferredSize":[0,0],"margins":[0,0,0,15],"orientation":"row","spacing":11,"alignChildren":["left","center"],"alignment":null}}},"order":[0,2,1,21,5,4,3,6,24,10,42,38,32,23,36,31,25,8,43,37,34,27,35,33,28,22,44,30,39,11,45,41],"settings":{"importJSON":true,"indentSize":false,"cepExport":false,"includeCSSJS":true,"showDialog":false,"functionWrapper":false,"afterEffectsDockable":false,"itemReferenceList":"None"}}
      */ 

      // DIALOG
      // ======
      var dialog = new Window("dialog"); 
          dialog.text = "Batch import & place images by the number in filename.jsx"; 
          dialog.orientation = "column"; 
          dialog.alignChildren = ["fill","top"]; 
          dialog.spacing = 10; 
          dialog.margins = 16; 

      // PANEL1
      // ======
      var panel1 = dialog.add("panel", undefined, undefined, {name: "panel1"}); 
          panel1.text = "Warning"; 
          panel1.orientation = "column"; 
          panel1.alignChildren = ["center","top"]; 
          panel1.spacing = 10; 
          panel1.margins = 29; 

      var statictext1 = panel1.add("statictext", undefined, undefined, {name: "statictext1"}); 
          statictext1.text = "Make sure to save the document before running the script. "; 
          statictext1.justify = "center"; 

      var statictext2 = panel1.add("statictext", undefined, undefined, {name: "statictext2"}); 
          statictext2.enabled = false; 
          statictext2.helpTip = "When layers are removed their contents are removed too!\n\nThe layer names are based on either the template name or the input folder name.\n\nSo if you change any of those names after running the script, it won't be able to remove layers automatically anymore."; 
          statictext2.text = "All layers previously created by it will be removed (?) "; 
          statictext2.justify = "center"; 

      // GROUP1
      // ======
      var group1 = panel1.add("group", undefined, {name: "group1"}); 
          group1.orientation = "row"; 
          group1.alignChildren = ["left","center"]; 
          group1.spacing = 10; 
          group1.margins = [0,16,0,0]; 

      var cancel = group1.add("button", undefined, undefined, {name: "cancel"}); 
          cancel.text = "Cancel"; 

      var ok = group1.add("button", undefined, undefined, {name: "ok"}); 
          ok.text = "Continue: select input folder"; 

      // PANEL2
      // ======
      var panel2 = dialog.add("panel", undefined, undefined, {name: "panel2"}); 
          panel2.enabled = false; 
          panel2.text = "Setup instructions"; 
          panel2.orientation = "column"; 
          panel2.alignChildren = ["fill","top"]; 
          panel2.spacing = 10; 
          panel2.margins = 29; 

      // GROUP2
      // ======
      var group2 = panel2.add("group", undefined, {name: "group2"}); 
          group2.orientation = "column"; 
          group2.alignChildren = ["fill","center"]; 
          group2.spacing = 5; 
          group2.margins = 0; 

      var statictext3 = group2.add("statictext", undefined, undefined, {name: "statictext3"}); 
          statictext3.helpTip = "You can place multiple multiple files on one page. Just make sure the templates don't overlap unnecessarily.\n\nYou can change this number regex in the script file."; 
          statictext3.text = "1. Make sure input folder items have page numbers in the front (?)"; 

      // GROUP3
      // ======
      var group3 = panel2.add("group", undefined, {name: "group3"}); 
          group3.orientation = "row"; 
          group3.alignChildren = ["left","center"]; 
          group3.spacing = 10; 
          group3.margins = [15,0,0,0]; 

      // PANEL3
      // ======
      var panel3 = group3.add("panel", undefined, undefined, {name: "panel3"}); 
          panel3.orientation = "column"; 
          panel3.alignChildren = ["left","top"]; 
          panel3.spacing = 10; 
          panel3.margins = 10; 

      // GROUP4
      // ======
      var group4 = panel3.add("group", undefined, {name: "group4"}); 
          group4.orientation = "row"; 
          group4.alignChildren = ["left","center"]; 
          group4.spacing = 10; 
          group4.margins = 0; 

      var statictext4 = group4.add("group"); 
          statictext4.orientation = "column"; 
          statictext4.alignChildren = ["left","center"]; 
          statictext4.spacing = 0; 

          statictext4.add("statictext", undefined, "input folder/01 my file.pdf", {name: "statictext4"}); 
          statictext4.add("statictext", undefined, "input folder/4 my file.pdf", {name: "statictext4"}); 
          statictext4.add("statictext", undefined, "input folder/21 another file.jpg", {name: "statictext4"}); 

      var divider1 = group4.add("panel", undefined, undefined, {name: "divider1"}); 
          divider1.alignment = "fill"; 

      var statictext5 = group4.add("group"); 
          statictext5.orientation = "column"; 
          statictext5.alignChildren = ["left","center"]; 
          statictext5.spacing = 0; 

          statictext5.add("statictext", undefined, "would end up in page 1", {name: "statictext5"}); 
          statictext5.add("statictext", undefined, "would end up in page 4", {name: "statictext5"}); 
          statictext5.add("statictext", undefined, "would end up in page 21", {name: "statictext5"}); 

      // GROUP5
      // ======
      var group5 = panel2.add("group", undefined, {name: "group5"}); 
          group5.orientation = "column"; 
          group5.alignChildren = ["fill","center"]; 
          group5.spacing = 5; 
          group5.margins = 0; 

      var statictext6 = group5.add("statictext", undefined, undefined, {name: "statictext6"}); 
          statictext6.helpTip = "This is technically optional. If you don't use a template, the image will be centered in the document.\n\nThe closest parent template is always used.\n\nYou can change this template identifier regex in the script file."; 
          statictext6.text = "2. Add template name to either the input folder, subfolder, or file (?)"; 

      // GROUP6
      // ======
      var group6 = panel2.add("group", undefined, {name: "group6"}); 
          group6.orientation = "row"; 
          group6.alignChildren = ["left","center"]; 
          group6.spacing = 10; 
          group6.margins = [15,0,0,0]; 

      // PANEL4
      // ======
      var panel4 = group6.add("panel", undefined, undefined, {name: "panel4"}); 
          panel4.orientation = "column"; 
          panel4.alignChildren = ["left","top"]; 
          panel4.spacing = 10; 
          panel4.margins = 10; 

      // GROUP7
      // ======
      var group7 = panel4.add("group", undefined, {name: "group7"}); 
          group7.orientation = "row"; 
          group7.alignChildren = ["left","center"]; 
          group7.spacing = 10; 
          group7.margins = 0; 

      var statictext7 = group7.add("group"); 
          statictext7.orientation = "column"; 
          statictext7.alignChildren = ["left","center"]; 
          statictext7.spacing = 0; 

          statictext7.add("statictext", undefined, "input folder @-template-1/1 my file.pdf", {name: "statictext7"}); 
          statictext7.add("statictext", undefined, "input folder @-template-1/@-template-2/20 my file.pdf", {name: "statictext7"}); 
          statictext7.add("statictext", undefined, "input folder @-template-1/20 my file @-template-2.pdf", {name: "statictext7"}); 

      var divider2 = group7.add("panel", undefined, undefined, {name: "divider2"}); 
          divider2.alignment = "fill"; 

      var statictext8 = group7.add("group"); 
          statictext8.orientation = "column"; 
          statictext8.alignChildren = ["left","center"]; 
          statictext8.spacing = 0; 

          statictext8.add("statictext", undefined, "uses master page \u0022@-template-1\u0022", {name: "statictext8"}); 
          statictext8.add("statictext", undefined, "uses master page \u0022@-template-2\u0022", {name: "statictext8"}); 
          statictext8.add("statictext", undefined, "uses master page \u0022@-template-2\u0022", {name: "statictext8"}); 

      // GROUP8
      // ======
      var group8 = panel2.add("group", undefined, {name: "group8"}); 
          group8.orientation = "column"; 
          group8.alignChildren = ["fill","center"]; 
          group8.spacing = 5; 
          group8.margins = 0; 

      var statictext9 = group8.add("statictext", undefined, undefined, {name: "statictext9"}); 
          statictext9.text = "3. Make new master pages that match the the template names"; 

      // GROUP9
      // ======
      var group9 = group8.add("group", undefined, {name: "group9"}); 
          group9.orientation = "row"; 
          group9.alignChildren = ["left","center"]; 
          group9.spacing = 11; 
          group9.margins = [15,0,0,0]; 

      var statictext10 = group9.add("group"); 
          statictext10.orientation = "column"; 
          statictext10.alignChildren = ["left","center"]; 
          statictext10.spacing = 0; 

          statictext10.add("statictext", undefined, "\u2022 You can run the script once to let it make all the necessary master pages.", {name: "statictext10"}); 
          statictext10.add("statictext", undefined, "\u2022 You still have to do the next step manually...", {name: "statictext10"}); 

      // GROUP10
      // =======
      var group10 = panel2.add("group", undefined, {name: "group10"}); 
          group10.orientation = "column"; 
          group10.alignChildren = ["fill","center"]; 
          group10.spacing = 5; 
          group10.margins = 0; 

      var statictext11 = group10.add("statictext", undefined, undefined, {name: "statictext11"}); 
          statictext11.text = "4. Add graphic frame(s) to all template master pages"; 

      // GROUP11
      // =======
      var group11 = group10.add("group", undefined, {name: "group11"}); 
          group11.orientation = "row"; 
          group11.alignChildren = ["left","center"]; 
          group11.spacing = 11; 
          group11.margins = [15,0,0,0]; 

      var statictext12 = group11.add("group"); 
          statictext12.orientation = "column"; 
          statictext12.alignChildren = ["left","center"]; 
          statictext12.spacing = 0; 

          statictext12.add("statictext", undefined, "\u2022 By default the images will simply be positioned in the center of the graphic frame.", {name: "statictext12"}); 
          statictext12.add("statictext", undefined, "\u2022 These graphic frames define the position and optionally the size too. ", {name: "statictext12"}); 
          statictext12.add("statictext", undefined, "\u2022 You can use 'Object &gt; Fitting &gt; Frame fitting options...' to make the images fit or fill inside the graphic frame.", {name: "statictext12"}); 


      
      // CUSTOMZATION:
      
      ok.onClick = function() {
        dialog.continue = true;
        dialog.close();
      }
      
      cancel.onClick = function() {
        dialog.continue = false;
        dialog.close();
      }
      
      dialog.show();
  
      return dialog;
    },
    
    progress: function( filesLength ) {
      
      var dialog = new Window ('palette', "Progress", undefined);
      dialog.orientation = "column";
      dialog.alignChildren = 'fill';
      
      dialog.add('statictext', undefined, undefined, {name:'desc'});
      dialog.desc.justify = 'center';
      
      dialog.add('progressbar', undefined, 0, filesLength, {name:'progressbar'});
      dialog.progressbar.preferredSize.width = 600;
      dialog.progressbar.preferredSize.height = 4;
      
      dialog.startTime = new Date().getTime();
      
      dialog.onShow = function() {
        this.location.y = 70;
      }
      
      dialog.show();
      
      dialog.update = function( item ) {
                
        if ( item ) this.text = 'Progress \u2014 ' + item.name;
        ++this.progressbar.value;
        var duration = this.msToMins( (new Date().getTime()) - this.startTime );
        var durationText = ' \u2014 Elapsed time: '+ duration;
        this.desc.text = this.progressbar.value + '/' + this.progressbar.maxvalue + durationText;
        
        if ( this.progressbar.value >= this.progressbar.maxvalue ) {
          settings.duration = duration;
          this.close();
        }
        return this;
        
      }
      
      dialog.msToMins = function(ms) {
        var minutes = Math.floor(ms / 60000);
        var seconds = ((ms % 60000) / 1000).toFixed(2);
        return (minutes ? minutes + "m " : '') + (minutes && seconds < 10 ? '0' : '') + seconds + 's';
      }

      return dialog;

    }
    
  },
  
  getFiles: function( folder ) {
  
    var filteredFiles = [];
    var files = folder.getFiles();
    
    for ( var i = 0; i < files.length; i++ ) {
      
      var file = files[i];
      
      var regex = new RegExp(".+\.(?:"+ (settings.custom.inputFormats ? settings.custom.inputFormats : 'tiff?|gif|jpe?g|bmp|eps|svg|png|ai|psd|pdf') +")$",'i');
      var fileFilter = file.name.match( regex );
      
      var isFile = (file instanceof File && fileFilter);
      var isFolder = (file instanceof Folder);
      
      if ( isFile ) {
        filteredFiles.push( file );
      }
  		else if ( isFolder ) {
        var folder = file;
  			filteredFiles = filteredFiles.concat( this.getFiles( folder ) );
  		}
      
    }
    
    return filteredFiles.length < 1 ? null : filteredFiles;
    
  },
  
  showPage: function( page ) {
    if ( settings.custom.showPage ) {
      
      app.activeDocument.addEventListener('afterPlace', afterPlace);

      function afterPlace() {
        
        // I didn't want to  fit and zoom after each file is placed, but when I did it beforehand, the document started to wander around a little...
        var fitPage = app.menuActions.itemByName("$ID/Fit Page In Window");
        if ( fitPage.isValid && fitPage.enabled ) fitPage.invoke();
        
        if ( settings.custom.showPageZoomOut ) {
          operations.eachLength( settings.custom.showPageZoomOut, function() {
            var zoomOut = app.menuActions.itemByName("$ID/Zoom Out");
            if ( zoomOut.isValid && zoomOut.enabled ) zoomOut.invoke();
          });
        }
        
        try { app.activeWindow.activePage = page; } catch(e) {}        
        if ( settings.custom.showPage ) $.sleep( settings.custom.showPageDelay );        
        app.activeDocument.removeEventListener('afterPlace', afterPlace);
        
      }
    }
  },
  
  place: {
    start: function() {
      
      if ( settings.custom.showPage ) {
        
        
      }
      
      var progressDialog = operations.dialog.progress( settings.files.length );
      
      operations.each( settings.files, function( file ) {
        
        var item = operations.make.item( file );
        progressDialog.update( item );
        
        if ( item ) {
          
          operations.showPage( item.page ); // Flashes page so you kinda see what is going on when the script is running...
          
          operations.each( item.graphicFrames, function( graphicFrame, index ) {
                       
            var originalLayer = item.graphicFrameLayers[ index ];
            if ( originalLayer ) { originalLayer = originalLayer.name }
            if ( item.templateDivision && item.templateDivision === originalLayer || !item.templateDivision ) {
              operations.place.graphic( graphicFrame, item );
            }
            
          });
          
          
        }
      }); 
      
      // Just so you won't accidentally add anything in these layers that doesn't belong there and
      // then end up removing it when running the script again...
      operations.each( settings.layers, function( layer ) {
        layer.locked = true;
      });
      
      alert('Done! \nElapsed time: ' + settings.duration );
      
    },
    graphic: function( graphicFrame, item ) {
      
      var cropOpt = settings.custom.pdfCrop || ['cropTrim', 'cropBleed', 'cropPDF', 'cropMedia'];
      
      operations.each( cropOpt, function( crop ) {
        
        try {
          app.pdfPlacePreferences.pdfCrop = PDFCrop[ crop ];
          app.pdfPlacePreferences.transparentBackground = settings.custom.pdfTransparentBackground == undefined ? true : settings.custom.pdfTransparentBackground;
          graphicFrame.place( item.file, false );
          return false;
        } catch (e) {}
        
      });
      
    },
    
  },
  // Check if given number is odd
  // Is used to check if the variable "page" is even or odd.
  // Helps the code to decide where the binding is.
  isOdd: function(n) {
    return n % 2;
  },
  
  print: {
    
    // operations.print.pageSide( app.activeWindow.activePage.side );
    pageSide: function( side ) {
      if ( side == '1818653800' ) {
        return 'left';
      }
      else if ( side == '1919382632' ) {
        return 'right';
      }
      else if ( side == '1970496888' ) {
        return 'single-sided';
      }
    }
    
  }
    
};




// ************************
// 	Release the hounds
// ************************
if ( app.documents.length > 0) {
  var warning = operations.dialog.warning();
  if ( warning.continue ) init();
} else {
  alert('ERROR:\n You need to open a document first.')
}
